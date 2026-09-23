/**
 * The OpenRouter client for the LLM belt.
 *
 * ## What this file is for, and what it is NOT allowed to do
 *
 * The belt exists to propose which sentence in an opinion supports a proposition. It is an
 * ADVISORY layer: nothing it returns is trusted. Every span it proposes is handed to the
 * deterministic matcher in `selfverify.ts`, which either finds it verbatim in the opinion or
 * rejects it. So this client's only job is to make one well-formed, reproducible request and
 * report honestly what came back.
 *
 * ## Measured facts behind the settings (`.recon/probe-seed-determinism.mjs`,
 *    `.recon/probe-provider-stability.mjs`, 2026-09-23)
 *
 * - **`temperature: 0` + a pinned `seed` gave byte-identical output on 5 of 5 identical requests.**
 *   Verified live against `google/gemini-2.5-flash`.
 * - **BUT all five were served by the same provider (Google).** OpenRouter load-balances across
 *   providers and `seed` is a per-provider parameter, so those five runs prove the seed is honoured
 *   *there* — not that a request routed elsewhere would agree. That is a real gap for a claim like
 *   "the demo replays identically", so this client **defaults to pinning the provider** rather than
 *   relying on routing luck. Pinning was confirmed accepted by the API.
 * - **Cost is reported per response** (`usage.cost`), and it VARIES between identical calls
 *   (measured $0.000505–$0.001884) because prompt caching changes the input cost. So cost is always
 *   logged from the response and never estimated from a price table.
 * - **The model declined honestly** when asked for a span supporting a proposition the opinion does
 *   not address, returning an empty string. That is better than the design assumed and is not
 *   depended on: an empty span is handled as a decline, not as a pass.
 *
 * ## The key
 *
 * Read from `process.env` at call time on the server only. It is never returned in a result object,
 * never logged, and never put in an error message — error text carries a redacted prefix at most.
 * `tests/selfverify.test.ts` asserts the key is absent from the built client bundle.
 */

/** Usage block, straight from the response. `cost` is authoritative — do not compute it. */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** USD, reported by OpenRouter. Varies between identical calls due to prompt caching. */
  costUsd: number | null;
  cachedTokens: number;
}

export interface ChatJsonRequest {
  model: string;
  seed: number;
  temperature: number;
  system: string;
  user: string;
  /** A JSON Schema object. Sent as `response_format: {type: "json_schema", json_schema: …}`. */
  schema: { name: string; schema: Record<string, unknown> };
  /** Provider slug to pin, e.g. "Google". When set, fallbacks are disabled. */
  pinProvider?: string;
  maxTokens?: number;
}

export interface ChatJsonResult<T> {
  value: T;
  usage: Usage;
  /** Which provider actually served it. Recorded so a replay can be compared. */
  provider: string;
  model: string;
  latencyMs: number;
  /** The generation id, for cross-referencing a run in OpenRouter's logs. */
  generationId: string | null;
}

export type OpenRouterFailureKind =
  /** No key configured. The belt is optional; this is not an error. */
  | "no-key"
  | "http"
  | "timeout"
  | "network"
  /** A 200 whose content was not the JSON the schema asked for. */
  | "bad-payload"
  | "bad-json";

export class OpenRouterFailure extends Error {
  readonly kind: OpenRouterFailureKind;
  readonly status?: number;
  constructor(kind: OpenRouterFailureKind, message: string, status?: number) {
    super(message);
    this.name = "OpenRouterFailure";
    this.kind = kind;
    this.status = status;
  }
  /** No key is expected in the no-key deployment, so callers degrade rather than report errors. */
  get isExpectedWithoutBelt(): boolean {
    return this.kind === "no-key";
  }
}

export interface OpenRouterDeps {
  /** Injectable so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /** Injectable so a test can force a timeout without waiting. */
  timeoutMs?: number;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;

/** Redact a key for any log line. Never print a full key, and never print part of a real one. */
export function redactKey(key: string | undefined): string {
  if (!key) return "(absent)";
  return `${key.slice(0, 6)}…(${key.length} chars)`;
}

/**
 * Remove the API key from arbitrary text before it is stored or returned.
 *
 * This exists because a test caught a real leak: the HTTP error body and the unparseable-content
 * body were being echoed into the attempt's `detail`, and those strings travel into the audit
 * result — which is served to the client. Nothing here assumes a response WON'T contain the key.
 * An upstream gateway, a proxy error page, or a debugging endpoint can echo the request headers,
 * and a key that reaches `detail` has reached the browser. So every byte of response text is
 * scrubbed before it is used in a message.
 *
 * Substring replacement rather than prefix matching: the key can appear anywhere, and a partial
 * echo is as damaging as a full one.
 */
export function scrubKey(text: string, key: string | undefined): string {
  if (!key) return text;
  let out = text.split(key).join("(redacted)");
  // Also catch a Bearer-prefixed echo, which would survive if only the bare key were replaced.
  const bearer = `Bearer ${key}`;
  out = out.split(bearer).join("Bearer (redacted)");
  // And the last-8 tail, in case a gateway truncates or abbreviates the credential.
  if (key.length > 12) {
    out = out.split(key.slice(-8)).join("(redacted)");
  }
  return out;
}

/**
 * One JSON-schema-constrained completion.
 *
 * Throws `OpenRouterFailure` on every failure path rather than returning null: the caller decides
 * whether a failure is tolerable (it is — the belt is optional), and a thrown typed error keeps the
 * reason available for the attempt log instead of being flattened into "no result".
 */
export async function completeJson<T>(
  req: ChatJsonRequest,
  apiKey: string | undefined,
  deps: OpenRouterDeps = {},
): Promise<ChatJsonResult<T>> {
  if (!apiKey) {
    throw new OpenRouterFailure("no-key", "OPENROUTER_API_KEY is not set, so the belt is unavailable");
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // The body is built with a fixed key order and contains no timestamp, so two calls with the same
  // inputs produce a BYTE-IDENTICAL request. That is what makes the seed reproducible: a body that
  // varied between runs would defeat the seed regardless of what the model does.
  const body: Record<string, unknown> = {
    model: req.model,
    temperature: req.temperature,
    seed: req.seed,
    response_format: {
      type: "json_schema",
      json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema },
    },
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
  };
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  // Pin the provider when asked. `allow_fallbacks: false` is the part that matters: without it
  // OpenRouter may route to a different provider mid-run and the seed guarantee is void.
  if (req.pinProvider) {
    body.provider = { order: [req.pinProvider], allow_fallbacks: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/JUICEWRLD998/citeproof",
        "X-Title": "CiteProof",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // An abort surfaces as an AbortError; report it as a timeout rather than a network error so
    // the attempt log distinguishes "we gave up waiting" from "the connection failed".
    const aborted = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    throw new OpenRouterFailure(
      aborted ? "timeout" : "network",
      aborted
        ? `the request exceeded ${timeoutMs}ms`
        : // A thrown fetch error can carry the request URL and, on some runtimes, request details.
          // Scrubbed rather than passed through.
          `request failed: ${scrubKey(err instanceof Error ? err.message : String(err), apiKey)}`,
    );
  }
  const latencyMs = Date.now() - startedAt;
  clearTimeout(timer);

  const raw = await res.text();
  if (res.status !== 200) {
    // Error bodies can echo the request, INCLUDING the Authorization header. Scrubbed, not merely
    // truncated: a truncated echo of a 41-character key still leaks most of it.
    throw new OpenRouterFailure(
      "http",
      `HTTP ${res.status}: ${scrubKey(raw, apiKey).slice(0, 300)}`,
      res.status,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new OpenRouterFailure(
      "bad-json",
      `response was not JSON: ${scrubKey(raw, apiKey).slice(0, 200)}`,
      200,
    );
  }

  const envelope = payload as {
    id?: string;
    model?: string;
    provider?: string;
    choices?: { message?: { content?: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };

  const content = envelope.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new OpenRouterFailure("bad-payload", "the response carried no message content", 200);
  }

  // Parse the CONTENT, never the serialized envelope. The plan is explicit: string-matching the
  // payload would happily "find" JSON-shaped text inside a model's prose explanation.
  let value: T;
  try {
    value = JSON.parse(content) as T;
  } catch {
    throw new OpenRouterFailure(
      "bad-payload",
      `content was not the JSON the schema asked for: ${scrubKey(content, apiKey).slice(0, 200)}`,
      200,
    );
  }

  const u = envelope.usage ?? {};
  return {
    value,
    usage: {
      promptTokens: u.prompt_tokens ?? 0,
      completionTokens: u.completion_tokens ?? 0,
      totalTokens: u.total_tokens ?? 0,
      // Cost is taken only when the API actually reported a number. A missing cost becomes null,
      // not an estimate — a fabricated cost in a demo budget is a lie about money.
      costUsd: typeof u.cost === "number" ? u.cost : null,
      cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    },
    provider: envelope.provider ?? "(not reported)",
    model: envelope.model ?? req.model,
    latencyMs,
    generationId: envelope.id ?? null,
  };
}
