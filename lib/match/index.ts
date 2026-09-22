import type { Span } from "../types";

function notImplemented(what: string): never {
  throw new Error(`${what} is not implemented yet — see implementation.md Phase 2.`);
}

/**
 * Deterministic text normalisation applied to BOTH the corpus text and the user's
 * quotation before comparison. Order matters; each step is pinned by a test that
 * reproduces a trap found in real corpus data:
 *
 *   1. Unicode NFC; curly quotes -> ASCII
 *   2. case-fold                        <- "Separate educational..." vs "separate educational..."
 *   3. collapse whitespace; join line-break hyphenation ("consti-\ntutional")
 *   4. OCR artefact repair
 *   5. do NOT strip reporter spacing ("347U.S.483") — that is the parser's job
 */
export function normalize(_s: string): string {
  return notImplemented("normalize");
}

/**
 * Find a quotation inside opinion text.
 * Returns offsets into the ORIGINAL (un-normalised) `opinionText`, or null.
 *
 * Offsets must round-trip: `opinionText.slice(span.start, span.end)` must return the
 * quotation as it appears in the corpus. Offsets into the normalised string deep-link
 * to the wrong characters and are worse than no offsets at all.
 */
export function findQuote(_opinionText: string, _quote: string): Span | null {
  return notImplemented("findQuote");
}

/** Find a quotation inside the user's document. Offsets into the user's original text. */
export function locateInDocument(_document: string, _quote: string): Span | null {
  return notImplemented("locateInDocument");
}
