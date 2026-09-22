/**
 * The LLM belt. OpenRouter + `google/gemini-2.5-flash`.
 *
 * Verified against OpenRouter's public models API on 2026-09-22:
 *   context_length 1048576 · max_completion_tokens 65535
 *   structured_outputs true · response_format true · seed true · temperature true
 *   $0.30/Mtok in · $2.50/Mtok out
 *
 * The 1M context is why there is no chunker, no vector store and no retrieval layer
 * anywhere in this repo: one opinion is ~6k tokens, so brief + opinion fit whole.
 *
 * DESIGN RULE, non-negotiable:
 *   the model may only PROPOSE a span. Whatever it returns must then be located
 *   verbatim in the opinion by lib/match. Model output passes the same verifier as
 *   the user's text. This is what makes the "AI checks AI" circularity breakable.
 */

export interface SpanProposal {
  /** The sentence the model claims supports the proposition. Must be verified after. */
  proposedSpan: string;
  /** The model's own confidence, 0..1. Recorded, never trusted on its own. */
  selfReportedConfidence: number;
}

export interface BeltConfig {
  apiKey: string;
  /** Pinned so the demo replays identically. */
  seed: number;
  temperature: number;
  model: string;
}

export const DEFAULT_BELT: Omit<BeltConfig, "apiKey"> = {
  model: "google/gemini-2.5-flash",
  seed: 20260922,
  temperature: 0,
};

function notImplemented(what: string): never {
  throw new Error(`${what} is not implemented yet — see implementation.md Phase 6.`);
}

/** Read the key from the environment. Returns null when absent — the belt is optional. */
export function beltConfigFromEnv(): BeltConfig | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return { ...DEFAULT_BELT, apiKey };
}

/**
 * Ask the model which sentence in the opinion supports a proposition.
 * Returns null when the belt is unconfigured — callers MUST degrade gracefully rather
 * than fail, so the app still audits without a key.
 */
export async function proposeSupportingSpan(
  _opinionText: string,
  _proposition: string,
  _config: BeltConfig | null,
): Promise<SpanProposal | null> {
  return notImplemented("proposeSupportingSpan");
}

/**
 * Verify a proposed span against the opinion using the deterministic matcher.
 * A proposal the matcher cannot find is an unsupported span, NOT a near miss.
 */
export function verifyProposal(_opinionText: string, _proposal: SpanProposal): boolean {
  return notImplemented("verifyProposal");
}
