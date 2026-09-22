/**
 * Deterministic text normalisation, applied to BOTH the corpus text and the user's quotation.
 *
 * Every rule here is either measured against the live corpus or explicitly marked as
 * unmeasured. `.recon/probe-normalisation-traps.mjs` re-derives all of it, and that matters:
 * the plan's Phase 2 acceptance lists FOUR traps, and one of them is not real.
 *
 *   trap                        status                evidence
 *   ---------------------------------------------------------------------------------------
 *   capitalisation              MEASURED, REAL        9564 hits for "Separate", -1 for "separate"
 *   curly quotes                MEASURED, REAL        177 U+201C, 168 U+201D, 103 U+2019
 *   line-break hyphenation      MEASURED ABSENT       0 occurrences across all fixtures
 *   `“s finding` -> `His`       RETRACTED, NOT REAL   0 occurrences of `“s`; the corpus reads
 *                                                      "this finding is amply supported by
 *                                                      modern authority", clean. The `“s` was
 *                                                      our own console truncation.
 *
 * The retracted one is the dangerous kind of rule. Implementing it would not fail loudly; it
 * would rewrite correct text into different correct-looking text, and the damage would surface
 * only as a lost match. So it is NOT implemented, and a test asserts the corpus is clean of it
 * so the decision is checked rather than trusted.
 */

export interface OriginRange {
  /** Index of the first ORIGINAL character this normalised character came from. */
  start: number;
  /** One past the last original character, so `original.slice(start, end)` is the source text. */
  end: number;
}

export interface NormalizedText {
  /** The normalised string. */
  text: string;
  /**
   * One entry per character of `text`, mapping it back to a range in the ORIGINAL string.
   *
   * A range rather than an index because whitespace runs collapse: one output space can stand
   * for a run of the original. Without the end, a match finishing on collapsed whitespace would
   * truncate its own span, and `opinionText.slice(start, end)` would not return the quotation.
   */
  origin: OriginRange[];
}

const QUOTE_MAP: Readonly<Record<string, string>> = {
  "‘": "'", // left single
  "’": "'", // right single — the apostrophe, 103 occurrences
  "‚": "'", // single low-9
  "‛": "'", // single high-reversed-9
  "“": '"', // left double, 177 occurrences
  "”": '"', // right double, 168 occurrences
  "„": '"', // double low-9
  "‟": '"', // double high-reversed-9
  "′": "'", // prime
  "″": '"', // double prime
};

const isSpace = (ch: string): boolean =>
  ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v";

/**
 * Collapse to a single space, case-fold, and map curly quotes — while recording where every
 * output character came from.
 *
 * Order, and why each step sits where it does:
 *
 *   1. NFC first. Measured length-preserving on all three fixtures and the brief, which is what
 *      lets the origin map start as the identity. A guard test asserts that property, so if a
 *      future fixture carries a composed sequence the suite says so instead of silently
 *      shifting every offset.
 *   2. Line-break hyphenation BEFORE whitespace collapse. The pattern is `-\n`, so collapsing
 *      whitespace first would destroy the newline we need to see and join.
 *   3. Curly quotes and case-folding, both length-preserving per character.
 *   4. Reporter spacing (`347U.S.483`) is deliberately untouched. §3.5 rule 5 is explicit that
 *      this belongs to the parser; mangling text here to serve the parser is how a normaliser
 *      starts corrupting quotations.
 */
export function normalizeWithMap(input: string): NormalizedText {
  const nfc = input.normalize("NFC");

  const out: string[] = [];
  const origin: OriginRange[] = [];
  let i = 0;

  while (i < nfc.length) {
    const ch = nfc[i];

    // 2. Line-break hyphenation: `consti-\ntutional` -> `constitutional`.
    //
    // MEASURED ABSENT in this corpus (0 occurrences), so this rule never fires on real data
    // today. It is kept because the plan requires it and because real filings do wrap
    // mid-word. It carries a genuine ambiguity that this layer cannot resolve: a real hyphen at
    // a line break ("well-\nknown") is indistinguishable from a wrapped word without a
    // dictionary, and this joins both.
    if (ch === "-" && nfc[i + 1] === "\n") {
      let j = i + 2;
      while (j < nfc.length && (nfc[j] === " " || nfc[j] === "\t")) j++;
      if (/[a-z]/.test(nfc[i - 1] ?? "") && /[a-z]/.test(nfc[j] ?? "")) {
        // Emit the hyphen as part of the preceding character's range by merging into the last
        // emitted entry, so the span still covers the original hyphen.
        const prev = origin[origin.length - 1];
        if (prev) prev.end = j;
        i = j;
        continue;
      }
    }

    // 3. Whitespace run -> one space.
    if (isSpace(ch)) {
      let j = i;
      while (j < nfc.length && isSpace(nfc[j])) j++;
      // A leading run is dropped entirely by the trim below; track it so the map stays aligned.
      out.push(" ");
      origin.push({ start: i, end: j });
      i = j;
      continue;
    }

    const mapped = QUOTE_MAP[ch];
    const folded = (mapped ?? ch).toLowerCase();
    // toLowerCase can expand a character (e.g. U+0130 -> "i̇", two code points). Keep the origin
    // range covering the whole original character for every emitted character.
    for (let k = 0; k < folded.length; k++) {
      out.push(folded[k]);
      origin.push({ start: i, end: i + 1 });
    }
    i++;
  }

  // Trim, keeping the map aligned with the surviving characters.
  let lo = 0;
  let hi = out.length;
  while (lo < hi && out[lo] === " ") lo++;
  while (hi > lo && out[hi - 1] === " ") hi--;

  return { text: out.slice(lo, hi).join(""), origin: origin.slice(lo, hi) };
}

/** Normalise without offsets. The comparison form, for both sides of a match. */
export function normalize(s: string): string {
  return normalizeWithMap(s).text;
}
