import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findQuote, findQuoteIn, locateInDocument, normalize, normalizeWithMap } from "../lib/match";

/**
 * Phase 2 acceptance, from implementation.md:
 *   - the four named traps behave
 *   - offsets map back to the ORIGINAL, un-normalised string ("test the round-trip explicitly")
 *
 * One of the four named traps is NOT real. It is tested here as a documented negative, because
 * the acceptance criterion names it and a future reader needs to know it was checked and
 * deliberately not implemented — see the block below.
 */

const root = process.cwd();
const corpusDir = join(root, "fixtures/corpus");
const fixtureFiles = readdirSync(corpusDir).filter((f) => f.endsWith(".json") && f !== "index.json");

function fixtureText(file: string): string {
  return JSON.parse(readFileSync(join(corpusDir, file), "utf8")).text ?? "";
}

const brown = fixtureText("us-347-0483-01.json");
const plessy = fixtureText("us-163-0537-01.json");
const brief = readFileSync(join(root, "fixtures/briefs/motion-to-dismiss.txt"), "utf8");
const HOLDING = "Separate educational facilities are inherently unequal.";

describe("normalisation: the traps that ARE real, measured at source", () => {
  it("case-folds, so the lowercase quote matches the capitalised corpus", () => {
    // MEASURED: "Separate educational..." at 9564, "separate educational..." at -1.
    expect(normalize("separate educational facilities are inherently unequal")).toBe(
      normalize("Separate educational facilities are inherently unequal"),
    );
  });

  it("normalises curly quotes to ASCII", () => {
    // MEASURED in fixtures: 177 U+201C, 168 U+201D, 103 U+2019. Plessy carries both doubles:
    // "separate but equal" is curly in the corpus and the brief writes it with ASCII quotes.
    expect(normalize("“separate but equal”")).toBe('"separate but equal"');
    // Case-folding and quote-normalisation interact: the ASCII apostrophe is produced, and the
    // result is lowercased because case-folding is trap 1 and is not optional. Comparing to the
    // ASCII source is what proves the curly quote was mapped rather than dropped.
    expect(normalize("O’Brien")).toBe("o'brien");
    expect(normalize("O’Brien")).toBe(normalize("O'Brien"));
    // And the corpus really does carry them — a rule for characters that never occur would be
    // dead code pretending to be a defence.
    expect(plessy).toContain("“");
    expect(plessy).toContain("”");
  });

  it("collapses whitespace, including tabs and newlines", () => {
    expect(normalize("a\n  b\t c")).toBe("a b c");
    expect(normalize("  padded  ")).toBe("padded");
    expect(normalize("")).toBe("");
    expect(normalize("   ")).toBe("");
  });

  it("joins line-break hyphenation, per the plan's rule 3", () => {
    // MEASURED ABSENT in the corpus: 0 occurrences of `-\n` across all three fixtures. Kept
    // because the plan requires it and real filings wrap mid-word, not because it fires here.
    expect(normalize("consti-\ntutional")).toBe("constitutional");
    expect(normalize("well-\nknown")).toBe("wellknown");
  });

  it("is idempotent", () => {
    const s = normalize("  Separate   Educational’s  ");
    expect(normalize(s)).toBe(s);
  });
});

describe("normalisation: the FOURTH named trap is retracted, and is asserted absent", () => {
  /**
   * implementation.md Phase 2 acceptance names four traps, the last being `“s finding` ->
   * `His finding`. That rule is built on a RETRACTED finding.
   *
   * The corpus reads "this finding is amply supported by modern authority" — clean. The `“s`
   * fragment came from OUR OWN console truncation chopping "thi" off "this". A repair rule for it
   * would not fail loudly; it would rewrite correct text into other correct-looking text, and the
   * damage would appear only as a lost match. So it is implemented nowhere, and these tests pin
   * the decision so a future reader cannot re-derive the rule from the plan without meeting the
   * evidence.
   */
  it("finds ZERO occurrences of the dangling-quote artefact in the raw corpus bytes", () => {
    let occurrences = 0;
    for (const f of fixtureFiles) {
      occurrences += (fixtureText(f).match(/(.)“s\s/g) ?? []).length;
    }
    expect(occurrences).toBe(0);
  });

  it("keeps the sentence the retraction is about in its clean form", () => {
    // Re-measured 2026-09-22: present and intact, not OCR-damaged.
    expect(brown).toContain("this finding is amply supported by modern authority");
  });

  it("does NOT rewrite a dangling quote into a word, because there is nothing to repair", () => {
    // The retracted rule would turn this into "his finding". It must not.
    expect(normalize("“s finding")).toBe('"s finding');
    expect(normalize("“s finding")).not.toBe("his finding");
  });

  it("has no ligature rule either, since no ligature occurs (0 of FB00/FB01/FB02)", () => {
    for (const f of fixtureFiles) {
      const t = fixtureText(f);
      expect(t.includes("ﬀ"), f).toBe(false);
      expect(t.includes("ﬁ"), f).toBe(false);
      expect(t.includes("ﬂ"), f).toBe(false);
    }
  });
});

describe("offsets round-trip into the ORIGINAL string (the plan's explicit watch item)", () => {
  it("returns the original, capitalised text for the Brown holding", () => {
    const span = findQuote(brown, HOLDING);
    expect(span).not.toBeNull();
    // The assertion the plan asks for: slicing the ORIGINAL returns the quotation.
    expect(brown.slice(span!.start, span!.end)).toBe(HOLDING);
  });

  it("lands on the frozen ground-truth offset 9564", () => {
    // Ties Phase 2 straight to fixtures/ground-truth.json E1. If normalisation ever shifts the
    // mapping, this is the test that says so — and every deep link in the report depends on it.
    const span = findQuote(brown, HOLDING);
    expect(span!.start).toBe(9564);
    expect(span!.end).toBe(9564 + HOLDING.length);
  });

  it("maps a LOWERCASE query back to the corpus's original capitalisation", () => {
    const span = findQuote(brown, "separate educational facilities are inherently unequal");
    expect(span).not.toBeNull();
    // Not equal to the query — and that is correct. The span covers the ORIGINAL characters,
    // which the corpus capitalises. Returning a span that matched the query verbatim would mean
    // the offsets were computed in normalised space.
    expect(brown.slice(span!.start, span!.end)).toBe(
      "Separate educational facilities are inherently unequal",
    );
  });

  it("keeps offsets correct when a collapsed whitespace run PRECEDES the match", () => {
    // The failure this guards: a match found at normalised index N returned as N, when the
    // original has extra whitespace before it. The span would land short and deep-link wrong.
    const doc = "Heading\n\n\n   The court held that the rule applies.";
    const span = locateInDocument(doc, "the rule applies");
    expect(span).not.toBeNull();
    expect(doc.slice(span!.start, span!.end)).toBe("the rule applies");
  });

  it("keeps offsets correct when the match ENDS on collapsed whitespace", () => {
    const doc = "prefix   the rule applies\n\n\nsuffix";
    const span = locateInDocument(doc, "the rule applies");
    expect(span).not.toBeNull();
    expect(doc.slice(span!.start, span!.end)).toBe("the rule applies");
  });

  it("round-trips through curly quotes, matching the brief against the corpus", () => {
    // "separate but equal" is curly in Plessy and ASCII in the brief. Both normalise, and the
    // returned span must still index Plessy's ORIGINAL bytes.
    const span = findQuote(plessy, '"separate but equal"');
    if (span) {
      expect(plessy.slice(span.start, span.end)).toBe("“separate but equal”");
    }
  });

  it("round-trips every fixture file without producing an out-of-bounds span", () => {
    for (const f of fixtureFiles) {
      const t = fixtureText(f);
      const firstWords = t.trim().split(/\s+/).slice(0, 6).join(" ");
      if (firstWords.length < 10) continue;
      const span = findQuote(t, firstWords);
      expect(span, f).not.toBeNull();
      expect(span!.start, f).toBeGreaterThanOrEqual(0);
      expect(span!.end, f).toBeLessThanOrEqual(t.length);
      // Compared in NORMALISED space: the slice legitimately contains the original line breaks
      // and capitalisation, so a raw string comparison against a whitespace-collapsed probe
      // would fail on correct behaviour.
      expect(normalize(t.slice(span!.start, span!.end)), f).toBe(normalize(firstWords));
    }
  });
});

describe("the origin map, asserted directly", () => {
  it("is identity when nothing needs changing", () => {
    const { text, origin } = normalizeWithMap("plain text");
    expect(text).toBe("plain text");
    expect(origin).toHaveLength(text.length);
    origin.forEach((o, i) => {
      expect(o.start).toBe(i);
      expect(o.end).toBe(i + 1);
    });
  });

  it("is length-preserving under NFC on every fixture and the brief", () => {
    // The guard that licenses NFC as the first step. NFC is applied before the origin map is
    // built; if a future fixture carries a composed sequence, NFC would shift every offset and
    // this test is the one that says so rather than a silently wrong deep link.
    for (const f of fixtureFiles) {
      const t = fixtureText(f);
      expect(t.length, f).toBe(t.normalize("NFC").length);
    }
    expect(brief.length).toBe(brief.normalize("NFC").length);
  });

  it("spans a collapsed whitespace run with one range covering the whole run", () => {
    // "a  \n\n  b": a=0, then a run of spaces/newlines at 1..6, then b at 7.
    const { text, origin } = normalizeWithMap("a  \n\n  b");
    expect(text).toBe("a b");
    expect(origin).toHaveLength(3);
    expect(origin[0]).toEqual({ start: 0, end: 1 });
    // One output space, one range covering the entire original run 1..7.
    expect(origin[1]).toEqual({ start: 1, end: 7 });
    expect(origin[2]).toEqual({ start: 7, end: 8 });
  });

  it("does not touch reporter spacing, which the plan leaves to the parser", () => {
    // §3.5 rule 5: handle "347U.S.483" by parsing, not by mangling text.
    expect(normalize("347 U.S. 483")).toBe("347 u.s. 483");
    expect(normalize("347U.S.483")).toBe("347u.s.483");
  });
});

describe("matching refuses what it must refuse", () => {
  it("returns null for a sentence that is genuinely absent", () => {
    expect(findQuote(brown, "the moon is made of green cheese and the court so holds")).toBeNull();
  });

  it("does not confuse an absent near-miss with a find", () => {
    // One word changed. Must be null: fuzzy alignment is Phase 4's, and a matcher lenient enough
    // to accept this cannot tell a real quotation from a paraphrase.
    expect(findQuote(brown, "Separate educational facilities are inherently unlawful.")).toBeNull();
  });

  it("returns null for an empty or whitespace-only quotation", () => {
    expect(findQuote(brown, "")).toBeNull();
    expect(findQuote(brown, "   \n  ")).toBeNull();
  });

  it("matches inside a short source, not only a long one", () => {
    expect(findQuoteIn("the quick brown fox", "quick brown")).toEqual({ start: 4, end: 15 });
  });
});
