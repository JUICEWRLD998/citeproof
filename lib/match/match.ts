import type { Span } from "../types";
import { normalizeWithMap } from "./normalize";

/**
 * Locate a quotation inside a source text, returning offsets into the ORIGINAL string.
 *
 * ## Why offsets are mapped rather than measured
 *
 * The obvious implementation — normalise both sides, find the index, return it — is wrong and
 * the plan flags it: "offsets into the normalised string are worse than no offsets, they
 * deep-link to the wrong characters." Case-folding is where it bites hardest. The corpus holds
 * `Separate` at original offset 9564; the normalised form is one character shorter by the time
 * you reach it only if anything upstream expanded, and any leading whitespace run collapse moves
 * it by more. A verdict that deep-links a user to offset 9564 of the *normalised* text points at
 * the wrong words in the *original*.
 *
 * So the match is found in normalised space and then mapped back through the origin table, and
 * the returned span always covers the original characters the match came from.
 *
 * ## Matching is EXACT after normalisation, in this phase
 *
 * The plan's match order is "normalised exact substring -> token-alignment fuzzy (>=0.92) -> not
 * found". Fuzzy alignment is Phase 4's task and is deliberately absent here, not forgotten. It is
 * listed for Phase 4 for a reason that the suite already tests: a matcher lenient enough to
 * accept one changed word cannot tell a real quotation from a paraphrase, and paraphrased-as-
 * quoted text is exactly what a fabricated citation is usually attached to.
 */
export function findQuoteIn(sourceText: string, quotation: string): Span | null {
  if (!quotation.trim()) return null;

  const source = normalizeWithMap(sourceText);
  const needle = normalizeWithMap(quotation).text;
  if (!needle) return null;

  const at = source.text.indexOf(needle);
  if (at < 0) return null;

  // Map the normalised match back onto the original characters.
  const first = source.origin[at];
  const last = source.origin[at + needle.length - 1];
  if (!first || !last) return null;

  return { start: first.start, end: last.end };
}

/**
 * Find a quotation inside opinion text. Offsets index the ORIGINAL `opinionText`.
 *
 * Returns the FIRST occurrence. An opinion can repeat a short phrase, and guessing which one the
 * drafter meant is not this layer's call; a later phase can widen this to all occurrences without
 * changing the contract.
 */
export function findQuote(opinionText: string, quote: string): Span | null {
  return findQuoteIn(opinionText, quote);
}

/** Find a quotation inside the user's document. Offsets index the user's ORIGINAL text. */
export function locateInDocument(document: string, quote: string): Span | null {
  return findQuoteIn(document, quote);
}

/** Every occurrence, for callers that need all of them. Still mapped to original offsets. */
export function findAllQuotes(opinionText: string, quote: string): Span[] {
  if (!quote.trim()) return [];
  const source = normalizeWithMap(opinionText);
  const needle = normalizeWithMap(quote).text;
  if (!needle) return [];

  const spans: Span[] = [];
  let from = 0;
  for (;;) {
    const at = source.text.indexOf(needle, from);
    if (at < 0) break;
    const first = source.origin[at];
    const last = source.origin[at + needle.length - 1];
    if (first && last) spans.push({ start: first.start, end: last.end });
    from = at + 1;
  }
  return spans;
}
