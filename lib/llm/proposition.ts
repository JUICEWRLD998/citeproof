import {
  completeJson,
  OpenRouterFailure,
  redactKey,
  scrubKey,
  type OpenRouterDeps,
  type Usage,
} from "./openrouter";

/**
 * Ask the belt which sentence in an opinion supports a proposition.
 *
 * Output contract, and it is deliberately narrow: the model returns a SPAN and a self-reported
 * confidence, and nothing else. No summary, no reasoning, no verdict. A model that could return a
 * verdict would be a model whose verdict we would then have to trust; one that can only return a
 * quotation is one we can check.
 *
 * ## The key and the no-key path
 *
 * `beltConfigFromEnv` returns null when `OPENROUTER_API_KEY` is absent, and every function here
 * degrades to `unavailable` rather than throwing. The plan's watch item is explicit — "never let the
 * demo depend on the belt being up" — so an audit with no key must complete and produce the same
 * deterministic verdicts from Phases 1–5, with the belt simply reporting nothing.
 */

/**
 * Version of the prompt and schema below. Recorded in the fixture beside the seed.
 *
 * The plan requires both to be recorded so a run can be attributed to a specific prompt. Change this
 * string whenever the wording or the schema changes, because a cached result from `p1` is not
 * comparable with one from `p2`.
 */
export const PROMPT_VERSION = "p1";

/** The model's raw output. Both fields are advisory until `selfverify` has checked the span. */
export interface SpanProposal {
  /** A sentence the model claims supports the proposition. Verified afterwards, never trusted. */
  proposedSpan: string;
  /** The model's own confidence. Recorded for the log; NEVER used to decide support. */
  selfReportedConfidence: number;
}

export interface BeltConfig {
  apiKey: string;
  /** Pinned so a run replays. Recorded in the fixture. */
  seed: number;
  temperature: number;
  model: string;
  /**
   * Provider slug to pin. Defaults to Google.
   *
   * Not decoration: `.recon/probe-provider-stability.mjs` saw all five identical requests served by
   * Google, so the seed was only ever proven to work on ONE provider. Pinning is what turns the
   * `seed` from a parameter that happened to work into a reproducible setting.
   */
  pinProvider?: string;
}

export const DEFAULT_SEED = 20260922;
export const DEFAULT_MODEL = "google/gemini-2.5-flash";
export const DEFAULT_PROVIDER = "Google";

/** Read config from the environment. Null when unconfigured — the belt is optional by design. */
export function beltConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BeltConfig | null {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const pinProvider = (env.OPENROUTER_PROVIDER ?? DEFAULT_PROVIDER).trim();
  return {
    apiKey,
    seed: DEFAULT_SEED,
    temperature: 0,
    model: (env.OPENROUTER_MODEL ?? DEFAULT_MODEL).trim(),
    // Empty string means "let OpenRouter route freely", for a caller who wants that explicitly.
    ...(pinProvider ? { pinProvider } : {}),
  };
}

/** Is the belt configured? Used by the UI to say which mode it is running in. */
export function beltAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return beltConfigFromEnv(env) !== null;
}

const SCHEMA_NAME = "span_proposal";
const PROPOSAL_SCHEMA = {
  name: SCHEMA_NAME,
  schema: {
    type: "object",
    properties: {
      proposedSpan: {
        type: "string",
        description:
          "One sentence copied character-for-character from the opinion that most directly supports the proposition. Copy exactly, including punctuation and case. Never paraphrase. Return an empty string if no sentence supports the proposition.",
      },
      selfReportedConfidence: {
        type: "number",
        description: "Your confidence that this sentence supports the proposition, from 0 to 1.",
      },
    },
    required: ["proposedSpan", "selfReportedConfidence"],
    additionalProperties: false,
  },
} as const;

/**
 * Deliberately stiff about copying.
 *
 * The measured baseline (probe-seed-determinism.mjs §3) was that the model's span WAS verbatim in
 * the opinion, and it declined an unsupported proposition rather than inventing one. The prompt
 * states the requirement anyway: the belt must not depend on the model being well behaved, since
 * the whole design exists because it might not be.
 */
const SYSTEM_PROMPT =
  "You extract verbatim quotations from judicial opinions. Copy text character-for-character from " +
  "the opinion supplied, preserving its punctuation, capitalisation and wording exactly. Never " +
  "paraphrase, never modernise, never reconstruct a quotation from memory. If no sentence in the " +
  "opinion supports the proposition, return an empty string for proposedSpan.";

function buildUserPrompt(opinionText: string, proposition: string): string {
  return (
    `OPINION:\n${opinionText}\n\n` +
    `PROPOSITION:\n${proposition}\n\n` +
    `Return the single sentence from the opinion that most directly supports the proposition, ` +
    `copied exactly. If none does, return an empty string.`
  );
}

export type PropositionStatus =
  /** The model returned a non-empty span. It has NOT yet been verified. */
  | "proposed"
  /** The model returned an empty span — an honest decline, not a failure. */
  | "declined"
  /** No key, so the belt did not run. The audit continues regardless. */
  | "unavailable";

export interface PropositionAttempt {
  proposition: string;
  proposal: SpanProposal | null;
  status: PropositionStatus;
  /** Human-readable, and safe to show: never contains the key. */
  detail: string;
  promptVersion: string;
  seed: number | null;
  model: string | null;
  provider: string | null;
  usage: Usage | null;
  latencyMs: number | null;
  generationId: string | null;
  /** Redacted key fingerprint, so a log can show WHICH key ran without exposing it. */
  keyFingerprint: string;
}

/**
 * Propose a supporting span, or report why not. Never throws.
 *
 * Returning a result object rather than a nullable proposal is deliberate: "the belt is
 * unconfigured", "the model declined" and "the request timed out" are three different facts, and
 * the attempt log has to tell them apart. Collapsing them into `null` is how a demo ends up saying
 * "no support found" when the truth is "we never asked".
 */
export async function proposeSupportingSpan(
  opinionText: string,
  proposition: string,
  config: BeltConfig | null,
  deps: OpenRouterDeps = {},
): Promise<PropositionAttempt> {
  const base: PropositionAttempt = {
    proposition,
    proposal: null,
    status: "unavailable",
    detail: "",
    promptVersion: PROMPT_VERSION,
    seed: config?.seed ?? null,
    model: config?.model ?? null,
    provider: null,
    usage: null,
    latencyMs: null,
    generationId: null,
    keyFingerprint: redactKey(config?.apiKey),
  };

  if (!config) {
    return {
      ...base,
      detail: "OPENROUTER_API_KEY is not set, so the belt did not run. The deterministic audit is unaffected.",
    };
  }

  try {
    const result = await completeJson<SpanProposal>(
      {
        model: config.model,
        seed: config.seed,
        temperature: config.temperature,
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(opinionText, proposition),
        schema: PROPOSAL_SCHEMA as { name: string; schema: Record<string, unknown> },
        pinProvider: config.pinProvider,
      },
      config.apiKey,
      deps,
    );

    const proposedSpan = typeof result.value?.proposedSpan === "string" ? result.value.proposedSpan : "";
    const confidence = Number(result.value?.selfReportedConfidence);

    const withMeta: PropositionAttempt = {
      ...base,
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
      generationId: result.generationId,
    };

    if (!proposedSpan.trim()) {
      return {
        ...withMeta,
        status: "declined",
        detail:
          "the model returned an empty span, so it found no sentence supporting the proposition. " +
          "That is a decline and NOT evidence the proposition is unsupported — the opinion either " +
          "does not address it or the model did not find the sentence.",
      };
    }

    return {
      ...withMeta,
      status: "proposed",
      proposal: {
        proposedSpan,
        selfReportedConfidence: Number.isFinite(confidence) ? confidence : 0,
      },
      detail: `the model proposed a ${proposedSpan.length}-character span with self-reported confidence ${
        Number.isFinite(confidence) ? confidence.toFixed(2) : "n/a"
      }. NOT yet verified.`,
    };
  } catch (err) {
    // A failure is recorded, not thrown: the belt is optional and an audit must complete without it.
    const kind = err instanceof OpenRouterFailure ? err.kind : "network";
    // Scrubbed again here even though the client already scrubs. The attempt travels into the audit
    // result, which is served to the client, so a key that reached `detail` by ANY path would reach
    // the browser — defence in depth is warranted on the one value that must never leave the server.
    const message = scrubKey(err instanceof Error ? err.message : String(err), config.apiKey);
    return {
      ...base,
      status: "unavailable",
      detail:
        kind === "no-key"
          ? "no key was supplied at call time, so the belt did not run."
          : `the belt request did not complete (${kind}): ${message}`,
    };
  }
}
