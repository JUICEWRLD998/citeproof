import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Citation } from "../lib/types";
import { normalize } from "../lib/match";
import { bindQuotations, isUnattributed, parseCitations, parseQuotations } from "../lib/resolve";

/**
 * Phase 2 acceptance, from implementation.md:
 *   - parses 347 U.S. 483 · 678 F. Supp. 3d 443 · 84 F. Supp. 3d 784 · 347 U.S. at 495
 *   - short-form carry-forward (Id., supra, at 495)
 *   - offsets map back to the original, un-normalised string
 *
 * The end-to-end block at the bottom runs against `fixtures/briefs/motion-to-dismiss.txt`, which
 * is the document the whole demo is built on, so a parser that passes the unit cases but cannot
 * read the real brief is caught here rather than in Phase 7.
 */

const brief = readFileSync(
  join(process.cwd(), "fixtures/briefs/motion-to-dismiss.txt"),
  "utf8",
);

describe("citation parsing: the shapes the acceptance criteria name", () => {
  it("parses a simple SCOTUS cite", () => {
    const [c] = parseCitations("See Brown v. Board of Education, 347 U.S. 483 (1954).");
    expect(c.volume).toBe(347);
    expect(c.reporter).toBe("U.S.");
    expect(c.page).toBe(483);
    expect(c.year).toBe(1954);
    expect(c.shortForm).toBe(false);
  });

  it("parses a modern district cite and reads the LONGEST reporter spelling", () => {
    // The trap: `F. Supp. 3d` must win over the shorter `F. Supp.`. If the shorter one matched,
    // this would parse as volume 678 / reporter "F. Supp." / page 3 with a stray "d 443" — a
    // silently WRONG citation that would then resolve to a real, unrelated case.
    const [c] = parseCitations("Mata v. Avianca, Inc., 678 F. Supp. 3d 443 (S.D.N.Y. 2023).");
    expect(c.reporter.replace(/\s+/g, " ")).toBe("F. Supp. 3d");
    expect(c.volume).toBe(678);
    expect(c.page).toBe(443);
    expect(c.year).toBe(2023);
  });

  it("parses 84 F. Supp. 3d 784 without truncating the page to '3'", () => {
    const [c] = parseCitations("See 84 F. Supp. 3d 784 (N.D. Ill. 2015).");
    expect(c.reporter.replace(/\s+/g, " ")).toBe("F. Supp. 3d");
    expect(c.volume).toBe(84);
    expect(c.page).toBe(784);
  });

  it("parses '347 U.S. at 495' as a pincite, not as a page", () => {
    // `at 495` states WHERE in the opinion, not where the case begins. Recording 495 as the page
    // would make the corpus layer look for a case starting at page 495 and fail.
    const [c] = parseCitations("See 347 U.S. at 495.");
    expect(c.volume).toBe(347);
    expect(c.page).toBe(0);
    expect(c.pincite).toBe(495);
    expect(c.shortForm).toBe(true);
  });

  it("reads a pincite that follows the page", () => {
    const [c] = parseCitations("Brown v. Board, 347 U.S. 483, 495 (1954).");
    expect(c.page).toBe(483);
    expect(c.pincite).toBe(495);
    expect(c.year).toBe(1954);
  });

  it("parses a citation split across a LINE BREAK, which the fixture brief contains", () => {
    // Verified in fixtures/briefs/motion-to-dismiss.txt: "163 U.S.\n537, 544 (1896)". A pattern
    // requiring a single line drops Plessy, and with it E2 and E5.
    const [c] = parseCitations("Plessy v. Ferguson, 163 U.S.\n537, 544 (1896).");
    expect(c.volume).toBe(163);
    expect(c.page).toBe(537);
    expect(c.pincite).toBe(544);
    expect(c.year).toBe(1896);
  });

  it("returns NO citation for an unmapped reporter, rather than inventing one", () => {
    // Same rule as the corpus layer. A confidently-parsed citation in a reporter we cannot reach
    // only moves the failure later and disguises a coverage limit as a resolution bug.
    expect(parseCitations("See 12 N.Y.S.2d 345 (1939).")).toHaveLength(0);
    expect(parseCitations("See 42 F.4th 100 (2022).")).toHaveLength(0);
  });

  it("does not read an arbitrary number pair as a citation", () => {
    expect(parseCitations("On page 12 of volume 4 the court said so.")).toHaveLength(0);
    expect(parseCitations("The motion was filed 3 times in 2023.")).toHaveLength(0);
  });

  it("emits offsets that slice back to the raw citation text", () => {
    const doc = "See Brown v. Board of Education, 347 U.S. 483, 495 (1954), and that is all.";
    const [c] = parseCitations(doc);
    expect(doc.slice(c.span.start, c.span.end)).toBe(c.raw);
    expect(c.raw).toContain("347 U.S. 483");
    expect(c.raw).toContain("1954");
  });
});

describe("short-form carry-forward", () => {
  it("carries the previous full citation forward for 'Id. at 495'", () => {
    const doc = "Brown v. Board, 347 U.S. 483, 490 (1954). Id. at 495.";
    const citations = parseCitations(doc);
    const id = citations.find((c) => /^Id\./.test(c.raw));
    expect(id, "the Id. form was not parsed").toBeDefined();
    // It resolves to Brown's coordinates, but reports the text a lawyer actually wrote.
    expect(id!.volume).toBe(347);
    expect(id!.reporter).toBe("U.S.");
    expect(id!.page).toBe(483);
    expect(id!.pincite).toBe(495);
    expect(id!.shortForm).toBe(true);
  });

  it("carries forward for 'supra'", () => {
    const doc = "See 163 U.S. 537 (1896). As noted supra, the holding stands.";
    const citations = parseCitations(doc);
    const supra = citations.find((c) => /supra/i.test(c.raw));
    expect(supra, "the supra form was not parsed").toBeDefined();
    expect(supra!.volume).toBe(163);
    expect(supra!.page).toBe(537);
  });

  it("does NOT invent a carrier when no full citation precedes the short form", () => {
    // An `Id.` with nothing before it is unattributable. Deriving coordinates from nothing would
    // manufacture a citation — the exact failure this product reports on.
    const citations = parseCitations("Id. at 495 was the rule applied.");
    expect(citations.every((c) => c.volume !== 347)).toBe(true);
    expect(citations.every((c) => c.shortForm)).toBe(true);
  });
});

describe("quotation parsing", () => {
  it("extracts interior text, NOT the quote marks, and offsets index the interior", () => {
    // ground-truth.json's `quote` values carry no surrounding quotes and its expectations are
    // built with `brief.indexOf(quote)`. Spanning the marks would put every offset one
    // character out on each side and disagree with the frozen ground truth.
    const doc = 'The Court held that "Separate educational facilities are inherently unequal."';
    const [q] = parseQuotations(doc);
    expect(q.raw).toBe("Separate educational facilities are inherently unequal.");
    expect(doc.slice(q.span.start, q.span.end)).toBe(q.raw);
    expect(doc[q.span.start - 1]).toBe('"');
    expect(doc[q.span.end]).toBe('"');
  });

  it("handles curly double quotes and returns the original curly bytes", () => {
    const doc = "It said “separate but equal” in terms.";
    const [q] = parseQuotations(doc);
    expect(q.raw).toBe("separate but equal");
    expect(doc.slice(q.span.start, q.span.end)).toBe("separate but equal");
  });

  it("handles a quotation spanning a line break", () => {
    const doc = 'held that "summary judgment is warranted only where the\nevidence is such".';
    const [q] = parseQuotations(doc);
    expect(q.raw).toContain("the\nevidence");
    expect(doc.slice(q.span.start, q.span.end)).toBe(q.raw);
  });

  it("does not let an unclosed quote swallow the document", () => {
    const doc = 'an opening " quote that never closes ' + "x".repeat(5000);
    expect(parseQuotations(doc)).toHaveLength(0);
  });

  it("returns no quotation for a document with no quotes", () => {
    expect(parseQuotations("No quotations here at all.")).toHaveLength(0);
  });
});

describe("binding quotations to citations", () => {
  const parse = (doc: string) => bindQuotations(parseCitations(doc), parseQuotations(doc));

  it("binds a quotation to the citation that PRECEDES it", () => {
    const [item] = parse('In 347 U.S. 483, the Court held that "the rule applies here."');
    expect(item.citation.volume).toBe(347);
    expect(isUnattributed(item.citation)).toBe(false);
  });

  it("binds a quotation to a citation that FOLLOWS it, which the brief requires for E5", () => {
    // fixtures/briefs/motion-to-dismiss.txt line 38-41 puts the quotation first and the citation
    // after it. A preceding-only rule drops that item entirely.
    const [item] = parse('the Court has long held that "the amendment is broad." Plessy v. Ferguson, 163 U.S. 537, 556 (1896).');
    expect(item.citation.volume).toBe(163);
    expect(item.citation.pincite).toBe(556);
  });

  it("binds to the citation the quotation actually sits NEAREST, in either direction", () => {
    // Corrected assertion. I first wrote this as "prefers the PRECEDING citation" and it failed:
    // the trailing `163 U.S. 537` is 11 characters away against the leading `347 U.S. 483`'s 22,
    // so nearest-wins picks the trailing one. Stating the real rule, not the one I assumed.
    const [item] = parse('See 347 U.S. 483. The Court said "the rule applies here." See also 163 U.S. 537.');
    expect(item.citation.volume).toBe(163);
  });

  it("binds to the preceding citation in the ordinary drafting shape", () => {
    const [item] = parse('In 347 U.S. 483, the Court held that "the rule applies here."');
    expect(item.citation.volume).toBe(347);
  });

  it("binds to the preceding citation even when the quotation is a long way after it", () => {
    const [item] = parse(
      'In 347 U.S. 483 the Court held that "the rule applies here." Much discussion follows, at length, before any other authority is reached.',
    );
    expect(item.citation.volume).toBe(347);
  });

  it("KNOWN LIMITATION: a closer trailing 'See also' can capture a quotation belonging to an earlier cite", () => {
    // Documented, not fixed. Nearest-wins measures character distance, which is a proxy for
    // intent and can be beaten: here the quotation plainly belongs to 347 U.S. 483, but the
    // trailing `163 U.S. 537` follows the closing quote mark by a few characters and wins.
    // The test pins the behaviour so the risk is visible; resolving it needs sentence structure,
    // which is Phase 3's cascade, not this parser's.
    const doc =
      'In 347 U.S. 483 the Court held that this proposition has been settled for many decades and remains the law of the land, "the rule applies here." See also 163 U.S. 537.';
    const [item] = parse(doc);
    expect(item.citation.volume).toBe(163);
  });

  it("marks an unattributable quotation instead of inventing a citation", () => {
    const [item] = parse('Somewhere it was written that "no court ever said this sentence."');
    expect(isUnattributed(item.citation)).toBe(true);
    expect(item.citation.volume).toBe(0);
    expect(item.citation.reporter).toBe("");
  });

  it("gives each item a stable id derived from its offsets", () => {
    const items = parse('In 347 U.S. 483, "the rule applies." And again, "the rule applies."');
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the real fixture brief, end to end", () => {
  const citations = parseCitations(brief);
  const quotations = parseQuotations(brief);
  const items = bindQuotations(citations, quotations);

  it("finds all five citations the brief contains", () => {
    const cites = citations.filter((c) => !c.shortForm).map((c) => c.raw);
    const joined = cites.join(" | ");
    expect(joined).toContain("347 U.S. 483");
    expect(joined).toContain("163 U.S. 537");
    expect(joined).toContain("999 U.S. 1234");
    expect(joined).toContain("678 F. Supp. 3d 443");
    // Plessy is cited twice (E2 and E5), so five citation spans total.
    expect(citations.filter((c) => c.volume === 163 && c.page === 537)).toHaveLength(2);
  });

  it("reads the pincite and year on every one of them", () => {
    const brown = citations.find((c) => c.volume === 347 && c.page === 483);
    expect(brown?.pincite).toBe(495);
    expect(brown?.year).toBe(1954);

    const mata = citations.find((c) => c.volume === 678);
    expect(mata?.pincite).toBe(452);
    expect(mata?.year).toBe(2023);
  });

  it("finds all five quotations", () => {
    expect(quotations).toHaveLength(5);
  });

  it("finds every quotation the frozen ground truth names", () => {
    // Compared in NORMALISED space, because the two sides are stored differently and that is a
    // property of the fixtures rather than a defect: ground-truth.json holds its quotations
    // whitespace-collapsed, while the brief wraps them across lines ("Separate educational\n
    // facilities are inherently unequal."). The parser returns the brief's ACTUAL bytes, which is
    // what a report must deep-link to, so a raw string comparison would fail on correct behaviour.
    const gt = JSON.parse(
      readFileSync(join(process.cwd(), "fixtures/ground-truth.json"), "utf8"),
    ) as { expectations: Array<{ id: string; quote: string; status?: string }> };
    const found = quotations.map((q) => normalize(q.raw));
    for (const e of gt.expectations) {
      if (e.status?.startsWith("PENDING")) continue;
      expect(found, `${e.id} quotation not extracted`).toContain(normalize(e.quote));
    }
  });

  it("locates each ground-truth quotation in the brief with a span that round-trips", () => {
    // This is the assertion that was missing before Phase 2. `brief.indexOf(e.quote)` returns -1
    // for EVERY expectation in this file — all five quotations wrap across lines — so the Phase 0
    // harness was building every item with a zero-length span at offset 0.
    const gt = JSON.parse(
      readFileSync(join(process.cwd(), "fixtures/ground-truth.json"), "utf8"),
    ) as { expectations: Array<{ id: string; quote: string; status?: string }> };
    for (const e of gt.expectations) {
      if (e.status?.startsWith("PENDING")) continue;
      // Record the fact that forces the matcher rather than a plain indexOf.
      expect(brief.indexOf(e.quote), `${e.id}: raw indexOf unexpectedly succeeded`).toBe(-1);

      const q = quotations.find((x) => normalize(x.raw) === normalize(e.quote));
      expect(q, `${e.id} not located`).toBeDefined();
      expect(brief.slice(q!.span.start, q!.span.end), `${e.id}`).toBe(q!.raw);
      expect(q!.raw.trim().length, `${e.id}`).toBeGreaterThan(0);
    }
  });

  it("binds the five brief quotations to the citations the ground truth attributes them to", () => {
    // Matched on NORMALISED text: the brief wraps mid-quotation ("counsel bears\na duty"), so a
    // raw substring probe for the unwrapped phrase silently finds nothing and the test fails on an
    // undefined lookup rather than on the binding it means to check.
    const byQuote = (needle: string) =>
      items.find((i) => normalize(i.quotation.raw).includes(normalize(needle))) as
        | (typeof items)[number]
        | undefined;

    // E1 Brown — citation precedes, and the nearer trailing Plessy cite must NOT capture it.
    const e1 = byQuote("Separate educational");
    expect(e1?.citation.volume, "E1 not bound").toBe(347);

    // E3 fabricated cite — "999 U.S. 1234", parsed even though the case cannot exist. Deciding
    // THAT is Phase 3's job; the parser only reports what the document says.
    expect(byQuote("summary judgment is warranted")?.citation.volume, "E3 not bound").toBe(999);

    // E4 post-coverage real case.
    expect(byQuote("counsel bears a duty")?.citation.volume, "E4 not bound").toBe(678);

    // E5 — the quotation comes FIRST and Plessy's second citation follows it. This is the shape a
    // preceding-only rule would drop.
    const e5 = byQuote("Fourteenth Amendment is not confined");
    expect(e5?.citation.volume, "E5 not bound").toBe(163);
    expect(e5?.citation.pincite).toBe(556);

    // E2 is the second occurrence of E1's sentence; it must bind to Plessy, not to Brown.
    const bothSeparate = items.filter((i) =>
      normalize(i.quotation.raw).includes(normalize("Separate educational facilities are inherently unequal")),
    );
    expect(bothSeparate).toHaveLength(2);
    expect(bothSeparate.map((i) => i.citation.volume)).toEqual([347, 163]);
  });

  it("leaves no quotation with an out-of-bounds span", () => {
    for (const q of quotations) {
      expect(q.span.start).toBeGreaterThanOrEqual(0);
      expect(q.span.end).toBeLessThanOrEqual(brief.length);
      expect(brief.slice(q.span.start, q.span.end)).toBe(q.raw);
    }
  });

  it("reports only citations whose reporter this build can actually reach", () => {
    for (const c of citations) {
      expect(c.reporter, c.raw).not.toBe("");
    }
  });
});
