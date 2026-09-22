import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findQuote, normalize } from "../lib/match";

/**
 * Each test here reproduces a trap that was measured against the live corpus, or is
 * labelled DEFENSIVE when it was not. A trap test whose premise is invented is worse
 * than no test, so the provenance of each is stated inline.
 */
const root = process.cwd();
const brownPath = join(root, "fixtures/corpus/us-347-0483-01.json");
let brownText = "";
try {
  brownText = JSON.parse(readFileSync(brownPath, "utf8"))
    .casebody.opinions.map((o: { text: string }) => o.text)
    .join("\n");
} catch {
  brownText = "";
}

describe("normalisation", () => {
  it("case-folds, so the lowercase quote matches the capitalised corpus", () => {
    // VERIFIED against us/347/cases/0483-01.json: the corpus reads "Separate" (capital S).
    // The lowercase form returns 0 occurrences in raw text — this is the trap that makes
    // a careless matcher report the most famous holding in US constitutional law as fake.
    expect(normalize("separate educational facilities are inherently unequal")).toBe(
      normalize("Separate educational facilities are inherently unequal"),
    );
  });

  it("normalises curly quotes to ASCII", () => {
    // VERIFIED present in corpus: Plessy's text carries U+201C/U+201D.
    expect(normalize("“separate but equal”")).toBe('"separate but equal"');
    expect(normalize("O’Brien")).toBe("O'Brien");
  });

  it("collapses whitespace and joins line-break hyphenation", () => {
    // DEFENSIVE: column-wrapped hyphenation was not observed in the two cases sampled.
    // Kept because the fixture brief and real filings do wrap mid-word.
    expect(normalize("consti-\ntutional")).toBe("constitutional");
    expect(normalize("a\n  b\t c")).toBe("a b c");
  });

  it("is idempotent", () => {
    const s = normalize("  Separate   Educational’s  ");
    expect(normalize(s)).toBe(s);
  });
});

describe("quote matching against real corpus text", () => {
  it("has the Brown fixture cached", () => {
    // Phase 1 writes this file. If it is missing the rest of this suite is meaningless,
    // and a silent skip would look like a pass.
    expect(brownText.length, "fixtures/corpus/us-347-0483-01.json missing — run Phase 1").toBeGreaterThan(20000);
  });

  it("finds the holding and returns offsets that round-trip", () => {
    const quote = "Separate educational facilities are inherently unequal.";
    const span = findQuote(brownText, quote);
    expect(span).not.toBeNull();
    // Offsets must index the ORIGINAL string, so this must return the quote verbatim.
    expect(brownText.slice(span!.start, span!.end)).toBe(quote);
  });

  it("finds the holding even when the query is lowercased — the flag-ship trap", () => {
    const span = findQuote(brownText, "separate educational facilities are inherently unequal");
    expect(span, "case-folding is not reaching the matcher").not.toBeNull();
  });

  it("returns null for a sentence that is genuinely absent", () => {
    const span = findQuote(brownText, "the moon is made of green cheese and the court so holds");
    expect(span).toBeNull();
  });

  it("does not confuse an absent near-miss with a find", () => {
    // One word changed. This must be null, not a fuzzy hit: a matcher lenient enough to
    // accept this cannot distinguish a real quote from a paraphrased one.
    const span = findQuote(brownText, "Separate educational facilities are inherently unlawful.");
    expect(span).toBeNull();
  });
});
