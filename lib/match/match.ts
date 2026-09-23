import type { Span } from "../types";
import { FUZZY_MATCH_THRESHOLD } from "../types";
import { normalizeWithMap, normalize, type NormalizedText } from "./normalize";

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

/**
 * Find the SINGLE best match for a quotation anywhere in a long source text.
 *
 * This is the entry point the verdict layer uses, and it exists because per-sentence splitting is
 * not adequate for corpus opinion text. Measured in `.recon/probe-fuzzy-threshold.mjs`: a
 * sentence in the Anderson opinion contains an internal `.` (the period inside `42 U.S.C. § 1983`)
 * and a `?` inside `What is the applicable standard?` — naive `[.!?]` splitting cuts mid-sentence,
 * so a matcher that only compared whole sentences reported **0.273** for a real sentence that is
 * present verbatim. The verdict layer must therefore check the EXACT path first (which cannot be
 * defeated by sentence boundaries) and only fall back to fuzzy comparison.
 *
 * Randomised token sampling was considered and rejected for the same reason: the report's whole
 * value proposition is that a lawyer can re-run it and get the same offsets, so this function has
 * no randomness in it at all.
 */
export function findBestMatch(
  sourceText: string,
  quotation: string,
  opts: { windowScale?: number; stride?: number } = {},
): MatchResult | null {
  if (!quotation.trim()) return null;

  // 1. Exact normalised substring. Handles the fixtures and every verbatim quotation, and is
  //    unaffected by sentence boundaries, punctuation or line wrapping.
  const exact = findQuoteIn(sourceText, quotation);
  if (exact) return { span: exact, similarity: 1, method: "exact" };

  // 2. Token-alignment fallback, in a bounded sliding window.
  const needle = normalize(quotation);
  const needleTokens = needle.split(" ").filter(Boolean);
  if (needleTokens.length < 3) return null;

  const source = normalizeWithMap(sourceText);
  const sourceTokens = source.text.split(" ").filter(Boolean);
  if (!sourceTokens.length) return null;

  const scale = opts.windowScale ?? 1.6;
  const stride = opts.stride ?? Math.max(1, Math.floor(needleTokens.length / 4));
  const windowSize = Math.ceil(needleTokens.length * scale);

  let best: MatchResult | null = null;
  for (let start = 0; start + needleTokens.length <= sourceTokens.length; start += stride) {
    const window = sourceTokens.slice(start, start + windowSize);
    const { distance, matches } = bestAlignment(needleTokens, window);
    // Score against the NEEDLE's length, not the window's: `bestAlignment` already makes the
    // window's unaligned ends free, and scoring by window length would penalise every correct
    // alignment all over again.
    const similarity = 1 - distance / needleTokens.length;
    // Strictly-better only, so a TIE keeps the EARLIEST occurrence. Two windows can genuinely tie
    // on a short, repeated phrase, and "first one, every run" is both the intuitive answer and the
    // one a lawyer can re-run; letting the later window win would be deterministic but surprising.
    if (best && similarity <= best.similarity) continue;
    // Below the floor we have nothing to record, but a later window can still clear it, so this
    // is a `continue` rather than a break.
    if (similarity < FUZZY_MATCH_THRESHOLD) continue;

    // `matches[i]` is the window token index needle token i aligned to, or -1 for a gap. The
    // matched run is the span between the first non-gap needle token and the last.
    const firstHit = matches.findIndex((m) => m >= 0);
    let lastHit = -1;
    for (let i = matches.length - 1; i >= 0; i--) {
      if (matches[i] >= 0) {
        lastHit = i;
        break;
      }
    }
    if (firstHit < 0 || lastHit < 0) continue;

    const startTok = start + matches[firstHit];
    const endTok = start + matches[lastHit];
    const span = tokenSpanToOriginal(source, sourceTokens, startTok, endTok);
    if (!span) continue;

    best = { span, similarity: Number(similarity.toFixed(4)), method: "fuzzy" };
  }

  return best;
}

/**
 * Fitting alignment: how well does the needle fit SOMEWHERE inside the window?
 *
 * The first implementation scored a plain edit distance against the whole window, and that was
 * wrong. The window is deliberately longer than the quotation (windowScale 1.6), so every token of
 * padding counted as an insertion against the needle: a genuine 25-token passage with one word
 * changed scored **0.36**, far below the 0.92 floor, and the fuzzy path was effectively dead.
 * Measured, not theorised — `.recon/probe-fuzzy-threshold.mjs` and a scratch harness both caught
 * it, the latter printing the hand-computed 0.96 beside the matcher's `null`.
 *
 * The fix is to make the window's unaligned ends FREE, which is the fitting (semi-global)
 * alignment: the first DP row is all zeroes, so the needle may begin anywhere in the window, and
 * the score is the best value in the last row, so it may end anywhere too. Only window tokens
 * lying BETWEEN the needle's first and last aligned token can incur an insertion cost, and those
 * are real — a quotation with a word inserted has genuinely diverged.
 */
function bestAlignment(
  needle: string[],
  window: string[],
): { distance: number; matches: number[] } {
  const n = needle.length;
  const m = window.length;

  // Row 0 is all zeroes: free to skip any window prefix without penalty.
  const prev = new Array<number>(m + 1).fill(0);
  const back = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let j = 0; j <= m; j++) back[0][j] = 2;

  for (let i = 1; i <= n; i++) {
    const cur = new Array<number>(m + 1);
    cur[0] = i;
    back[i][0] = 1;
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (needle[i - 1] === window[j - 1] ? 0 : 1);
      const del = prev[j] + 1; // needle token with no partner
      const ins = cur[j - 1] + 1; // window token with no partner
      if (sub <= del && sub <= ins) {
        cur[j] = sub;
        back[i][j] = 0; // match or substitution
      } else if (del <= ins) {
        cur[j] = del;
        back[i][j] = 1;
      } else {
        cur[j] = ins;
        back[i][j] = 2;
      }
    }
    for (let j = 0; j <= m; j++) prev[j] = cur[j];
  }

  // The needle may END anywhere in the window, so the distance is the best value of the last row.
  let endCol = 0;
  for (let j = 1; j <= m; j++) if (prev[j] < prev[endCol]) endCol = j;

  // Walk back to recover which window token each needle token aligned to. Anything still
  // unaligned by the time the needle is consumed stays -1 and is excluded from the span.
  const matches = new Array<number>(n).fill(-1);
  let i = n;
  let j = endCol;
  while (i > 0 && j >= 0) {
    const dir = back[i][j];
    if (dir === 0) {
      matches[i - 1] = j - 1;
      i--;
      j--;
    } else if (dir === 1) {
      i--;
    } else {
      j--;
    }
  }

  return { distance: prev[endCol], matches };
}

/** Map a whole-token span in normalised space back to a character span in the ORIGINAL text. */
function tokenSpanToOriginal(
  source: NormalizedText,
  sourceTokens: string[],
  startTok: number,
  endTok: number,
): Span | null {
  if (startTok < 0 || endTok < startTok) return null;
  // Character offset of the first token: the normalised text is the tokens joined by single
  // spaces, so the prefix length is exact.
  let startChar = 0;
  for (let t = 0; t < startTok; t++) startChar += sourceTokens[t].length + 1;
  let endChar = startChar;
  for (let t = startTok; t <= endTok; t++) endChar += sourceTokens[t].length + 1;
  endChar -= 1; // no trailing space

  const first = source.origin[startChar];
  const last = source.origin[Math.max(startChar, endChar - 1)];
  if (!first || !last) return null;
  return { start: first.start, end: last.end };
}

export interface MatchResult {
  /** Offsets into the ORIGINAL source text. */
  span: Span;
  /** 1.0 for an exact normalised match. */
  similarity: number;
  method: "exact" | "fuzzy";
}

