import type { Span } from "../types";
import { MIN_VERBATIM_RUN_TOKENS } from "../types";
import { findQuoteIn } from "../match";
import { normalize, normalizeWithMap } from "../match/normalize";
import type { PropositionAttempt, SpanProposal } from "./proposition";

/**
 * Self-verification: the belt's span is checked by the deterministic matcher, not trusted.
 *
 * This is the file that makes "AI checks AI" breakable. The model proposes a sentence; this code
 * either finds that sentence in the opinion, byte-for-byte after normalisation, or refuses to
 * report it as support. There is no path here where the model's own confidence, its wording, or its
 * fluency can produce a "supported" result — only a located span can.
 *
 * ## The one rule
 *
 * **A proposal the matcher cannot find VERBATIM is an unsupported span, not a near miss.**
 *
 * That is deliberate, and it is the stricter reading. A supporting span exists so a reader can be
 * shown the evidence in the court's own words; a span that is 96% similar is not a quotation, and
 * rendering it alongside a real one would be the tool laundering a paraphrase into authority. So
 * `method === "exact"` is required for `supported`.
 *
 * ## What the fuzzy path is still used for
 *
 * Diagnostics, and they are worth having: they separate two failures a reader would otherwise
 * conflate. "The model paraphrased a real sentence" and "the model produced text that appears
 * nowhere in the opinion" are different problems — the first is a prompt/adherence issue, the second
 * is fabrication — and reporting which one happened costs nothing and helps whoever debugs it. The
 * similarity is reported BESIDE an `unsupported` verdict and never changes it.
 *
 * Measured baseline (`.recon/probe-seed-determinism.mjs`): the model's span was verbatim and it
 * declined an unsupported proposition outright. Neither behaviour is relied on — the belt is
 * verified precisely because it might not do either.
 */

export type VerificationStatus =
  /** The span was located verbatim. The only status that reports support. */
  | "supported"
  /** The model returned no span — an honest decline. Not a failure, and not support either. */
  | "declined"
  /** The span was not found verbatim. This is the status the product exists to be able to produce. */
  | "unsupported"
  /** The belt did not run, so nothing was proposed. */
  | "unavailable";

export interface Verification {
  status: VerificationStatus;
  /** Where the span sits in the opinion. Present only when `supported`. */
  span?: Span;
  /**
   * The opinion's OWN text at that span.
   *
   * Reported so a caller renders the court's bytes rather than the model's. Normalisation tolerates
   * whitespace and quote-mark differences, so the model's string and the opinion's can differ
   * character-by-character while matching — and the opinion's is the one that is evidence.
   */
  verbatim?: string;
  /** The model's self-reported confidence, carried through for the log. Never affects status. */
  selfReportedConfidence?: number;
  /**
   * Diagnostic only, on an unsupported span: the longest run of consecutive words the proposal
   * shares VERBATIM with the opinion. See `MIN_VERBATIM_RUN_TOKENS` — this replaces a similarity
   * score that measurement showed could not tell a paraphrase from an invention.
   */
  sharedRunWords?: number;
  /** Diagnostic only: that run's text, taken from the OPINION's bytes rather than the model's. */
  sharedRunText?: string;
  /** Plain-language explanation, safe to display. */
  reason: string;
}

/**
 * Verify a proposed span against the opinion it claims to come from.
 *
 * Deliberately does not take the model's confidence into account at all. Accepting a span because
 * the model was confident would put the model back in charge of the verdict, which is the one thing
 * this design cannot allow.
 */
export function verifyProposal(opinionText: string, proposal: SpanProposal | null): Verification {
  if (!proposal) {
    return {
      status: "declined",
      reason: "the belt produced no proposal, so there is no span to verify.",
    };
  }

  const claimed = proposal.proposedSpan ?? "";
  const confidence = proposal.selfReportedConfidence;

  if (!claimed.trim()) {
    return {
      status: "declined",
      selfReportedConfidence: confidence,
      reason:
        "the model returned an empty span, so it found no sentence supporting the proposition. " +
        "A decline is not evidence the proposition is unsupported.",
    };
  }

  // The decisive check. `findQuoteIn` is the exact normalised matcher — the same one that checks the
  // user's own quotations, so the belt's output passes the identical verifier.
  const exact = findQuoteIn(opinionText, claimed);
  if (exact) {
    return {
      status: "supported",
      span: exact,
      verbatim: opinionText.slice(exact.start, exact.end),
      selfReportedConfidence: confidence,
      reason:
        `the proposed span was located verbatim in the opinion at chars ${exact.start}–${exact.end}, ` +
        `so it is real supporting text rather than a claim about one.`,
    };
  }

  // Not found. Describe HOW it was wrong, which is what a reader debugging the belt needs.
  //
  // See MIN_VERBATIM_RUN_TOKENS for why this is a contiguous-run measure and not a similarity score.
  // The short version: similarity was measured and it separates nothing — a real sentence the model
  // extended scored 0.400, identical to a fully invented one.
  const overlap = longestVerbatimRun(opinionText, claimed);

  if (overlap.words >= MIN_VERBATIM_RUN_TOKENS) {
    // The model drew on real text but presented something that is not a quotation. Reported as
    // unsupported either way — a real fragment inside a false sentence is still a false sentence.
    return {
      status: "unsupported",
      selfReportedConfidence: confidence,
      sharedRunWords: overlap.words,
      sharedRunText: overlap.text,
      reason:
        `the proposed span is NOT in the opinion as quoted. It shares a ${overlap.words}-word ` +
        `verbatim run with real text — "${overlap.text}" — so the model drew on a genuine passage ` +
        `but presented it embedded in wording the opinion does not contain. A real fragment inside ` +
        `a false sentence is still not a quotation, so this is not support.`,
    };
  }

  return {
    status: "unsupported",
    selfReportedConfidence: confidence,
    sharedRunWords: overlap.words,
    sharedRunText: overlap.text || undefined,
    reason:
      `the proposed span appears nowhere in the opinion. Its longest verbatim run shared with the ` +
      `opinion is ${overlap.words} word(s)` +
      (overlap.text ? ` ("${overlap.text}")` : "") +
      `, which is incidental overlap rather than reproduction. The text the model attributed to the ` +
      `court is not in the court's opinion.`,
  };
}

/**
 * The longest run of consecutive words the proposal shares with the opinion, verbatim.
 *
 * Contiguity on BOTH sides is the point: a set of words that merely all occur somewhere in a
 * 6,000-word opinion tells you nothing, whereas twelve consecutive words in the same order is
 * unmistakably a real quotation the model drew on.
 */
function longestVerbatimRun(
  opinionText: string,
  proposal: string,
): { words: number; text: string } {
  const proposalTokens = normalize(proposal).split(" ").filter(Boolean);
  if (!proposalTokens.length) return { words: 0, text: "" };

  const source = normalizeWithMap(opinionText);
  const { tokens: sourceTokens, starts } = tokenizeWithOffsets(source.text);
  if (!sourceTokens.length) return { words: 0, text: "" };

  let bestWords = 0;
  let bestSourceStart = -1;
  for (let i = 0; i < proposalTokens.length; i++) {
    // Nothing longer can start here, so stop scanning.
    if (proposalTokens.length - i <= bestWords) break;
    for (let j = 0; j < sourceTokens.length; j++) {
      if (sourceTokens[j] !== proposalTokens[i]) continue;
      let k = 0;
      while (
        i + k < proposalTokens.length &&
        j + k < sourceTokens.length &&
        proposalTokens[i + k] === sourceTokens[j + k]
      ) {
        k++;
      }
      if (k > bestWords) {
        bestWords = k;
        bestSourceStart = j;
      }
    }
  }

  if (bestWords === 0) return { words: 0, text: "" };

  // Map the run back to the OPINION's own bytes through the normalisation origin map, so the text
  // reported is the court's, never the model's rendering of it.
  const firstChar = starts[bestSourceStart];
  const lastToken = bestSourceStart + bestWords - 1;
  const lastChar = starts[lastToken] + sourceTokens[lastToken].length;
  const originStart = source.origin[firstChar]?.start;
  const originEnd = source.origin[lastChar - 1]?.end;
  if (originStart === undefined || originEnd === undefined) return { words: bestWords, text: "" };

  return { words: bestWords, text: opinionText.slice(originStart, originEnd) };
}

/** Split normalised text into tokens, recording each token's offset in the normalised string. */
function tokenizeWithOffsets(text: string): { tokens: string[]; starts: number[] } {
  const tokens: string[] = [];
  const starts: number[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && text[i] === " ") i++;
    if (i >= text.length) break;
    const start = i;
    while (i < text.length && text[i] !== " ") i++;
    tokens.push(text.slice(start, i));
    starts.push(start);
  }
  return { tokens, starts };
}

/** A verified proposition attempt: the proposal, plus what verification made of it. */
export interface VerifiedProposition {
  proposition: string;
  attempt: PropositionAttempt;
  verification: Verification;
}

/**
 * Verify an attempt, honouring the belt's own status.
 *
 * An `unavailable` attempt is reported as `unavailable` rather than `declined`: if no key was set,
 * nothing was proposed, and saying "the model declined" would be a false statement about a model
 * that was never asked. The distinction matters for the same reason the attempt log exists — a demo
 * must never present "we did not ask" as a finding.
 */
export function verifyAttempt(opinionText: string, attempt: PropositionAttempt): Verification {
  if (attempt.status === "unavailable") {
    return {
      status: "unavailable",
      reason: `the belt did not run, so nothing was proposed. ${attempt.detail}`,
    };
  }
  if (attempt.status === "declined") {
    return { status: "declined", reason: attempt.detail };
  }
  return verifyProposal(opinionText, attempt.proposal);
}

export interface BeltSummary {
  total: number;
  supported: number;
  unsupported: number;
  declined: number;
  unavailable: number;
  /** Total reported cost, or null when no run reported one. Never estimated. */
  costUsd: number | null;
  /** Providers that actually served the runs — plural, so a replay can spot a reroute. */
  providers: string[];
}

/**
 * Summarise a belt run.
 *
 * `costUsd` is null rather than 0 when nothing reported a cost: a run with no key must not look like
 * a run that cost nothing, and a run whose responses omitted cost must not be silently priced at a
 * guess.
 */
export function summarise(results: VerifiedProposition[]): BeltSummary {
  const summary: BeltSummary = {
    total: results.length,
    supported: 0,
    unsupported: 0,
    declined: 0,
    unavailable: 0,
    costUsd: null,
    providers: [],
  };

  let sawCost = false;
  let cost = 0;
  for (const r of results) {
    summary[r.verification.status] += 1;
    const u = r.attempt.usage;
    if (u && typeof u.costUsd === "number") {
      sawCost = true;
      cost += u.costUsd;
    }
    if (r.attempt.provider && !summary.providers.includes(r.attempt.provider)) {
      summary.providers.push(r.attempt.provider);
    }
  }

  summary.costUsd = sawCost ? cost : null;
  return summary;
}
