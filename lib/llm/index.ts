/**
 * The LLM belt. OpenRouter + `google/gemini-2.5-flash`.
 *
 * Verified against OpenRouter's public models API on 2026-09-22:
 *   context_length 1048576 · max_completion_tokens 65535
 *   structured_outputs true · response_format true · seed true · temperature true
 *   $0.30/Mtok in · $2.50/Mtok out
 *
 * The 1M context is why there is no chunker, no vector store and no retrieval layer anywhere in this
 * repo: one opinion is ~6k tokens, so brief + opinion fit whole.
 *
 * DESIGN RULE, non-negotiable:
 *   the model may only PROPOSE a span. Whatever it returns must then be located verbatim in the
 *   opinion by lib/match. Model output passes the same verifier as the user's text. That is what
 *   makes the "AI checks AI" circularity breakable.
 *
 * OPTIONAL BY DESIGN. With no `OPENROUTER_API_KEY` the belt reports `unavailable` and the
 * deterministic Phases 1–5 audit is unchanged. Nothing here may ever be required for an audit to
 * complete — the plan's watch item is explicit that the demo must not depend on the belt being up.
 *
 * Phase 6 implementation notes, all measured 2026-09-23 with `.recon/probe-seed-determinism.mjs` and
 * `.recon/probe-provider-stability.mjs`:
 *   - `temperature: 0` + pinned seed gave byte-identical output on 5/5 identical live requests.
 *   - All 5 were served by ONE provider, so the provider is PINNED by default instead of trusting
 *     routing. `seed` is a per-provider parameter and OpenRouter load-balances across providers.
 *   - `usage.cost` is reported per response and VARIES between identical calls, so cost is logged
 *     from the response and never estimated.
 *   - The model declined an unsupported proposition with an empty span rather than inventing one.
 *     Handled, and deliberately not relied upon.
 */

import {
  beltAvailable,
  beltConfigFromEnv,
  proposeSupportingSpan,
  type BeltConfig,
  type PropositionAttempt,
} from "./proposition";
import { verifyAttempt, type Verification, type VerifiedProposition } from "./selfverify";
import type { OpenRouterDeps } from "./openrouter";

export {
  completeJson,
  OpenRouterFailure,
  redactKey,
  scrubKey,
  type ChatJsonRequest,
  type ChatJsonResult,
  type OpenRouterDeps,
  type OpenRouterFailureKind,
  type Usage,
} from "./openrouter";

export {
  beltAvailable,
  beltConfigFromEnv,
  proposeSupportingSpan,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  DEFAULT_SEED,
  PROMPT_VERSION,
  type BeltConfig,
  type PropositionAttempt,
  type PropositionStatus,
  type SpanProposal,
} from "./proposition";

export {
  summarise,
  verifyAttempt,
  verifyProposal,
  type BeltSummary,
  type Verification,
  type VerificationStatus,
  type VerifiedProposition,
} from "./selfverify";

/** Belt mode, for the UI to state which path it is running. */
export type BeltMode = "belt-enabled" | "deterministic-only";

export function beltMode(env: NodeJS.ProcessEnv = process.env): BeltMode {
  return beltAvailable(env) ? "belt-enabled" : "deterministic-only";
}

/**
 * Propose and verify in one call — the only shape callers should normally need.
 *
 * It exists so no caller can accidentally consume a proposal WITHOUT verifying it. The two steps are
 * separate functions because each is worth testing alone, but exposing a combined entry point means
 * the unverified path is not the easy one to reach for.
 *
 * It never throws: a belt failure is reported as `unavailable` and the audit continues, because the
 * belt is optional and the deterministic path must always complete.
 */
export async function proposeAndVerify(
  opinionText: string,
  proposition: string,
  config: BeltConfig | null = beltConfigFromEnv(),
  deps: OpenRouterDeps = {},
): Promise<VerifiedProposition> {
  const attempt: PropositionAttempt = await proposeSupportingSpan(
    opinionText,
    proposition,
    config,
    deps,
  );
  const verification: Verification = verifyAttempt(opinionText, attempt);
  return { proposition, attempt, verification };
}
