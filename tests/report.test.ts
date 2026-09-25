import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDocumentRows,
  buildReport,
  emptyCounts,
  propositionFor,
  summarise,
  MAX_PROPOSITION_CHARS,
  type DocSegment,
} from "@/lib/report/bundle";
import { caseSourceLink, SOURCE_INDEX_SIZE } from "@/lib/report/sources";
import { MAX_REPORTS, getReport, putReport, reportCount, reportId } from "@/lib/report/store";
import { runAudit, documentTitle } from "@/lib/report/audit-run";
import { bindQuotations, parseCitations, parseQuotations } from "@/lib/resolve";

/**
 * Phase 7 is UI, and a UI is verified by looking at it — `.recon/driver.mjs` does that. These tests
 * cover the part a screenshot cannot: the arithmetic between the engine's output and what the page
 * renders.
 *
 * The one that matters most is the offset round-trip. Every mark on the annotated brief slices the
 * document by an offset the parser measured, and if those slices are wrong the page renders a
 * plausible, confident, WRONG document — the exact failure this product exists to catch in other
 * people's work, committed on its own front page.
 */

const root = process.cwd();
const brief = readFileSync(join(root, "fixtures/briefs/motion-to-dismiss.txt"), "utf8");

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

describe("report: the annotated document keeps its own offsets", () => {
  const citations = parseCitations(brief);
  const quotations = parseQuotations(brief);
  const items = bindQuotations(citations, quotations);
  const rows = buildDocumentRows(brief, items);

  it("segments tile each row without overlapping, and every row belongs to the document", () => {
    for (const row of rows) {
      expect(row.start).toBeLessThan(row.end);
      let cursor = row.start;
      for (const seg of row.segments) {
        expect(seg.start, "a segment starts before the previous one ended").toBe(cursor);
        expect(seg.end).toBeGreaterThan(seg.start);
        // The text a segment claims is exactly the text at those offsets. If this drifts, every
        // mark on the page is drawn in the wrong place.
        expect(brief.slice(seg.start, seg.end)).toBe(seg.text);
        cursor = seg.end;
      }
      expect(cursor).toBe(row.end);
    }
  });

  it("rows reconstruct the document between their own bounds", () => {
    const rebuilt = rows.map((r) => brief.slice(r.start, r.end)).join("\n");
    expect(collapse(rebuilt)).toBe(collapse(brief));
  });

  it("marks every audited quotation, and the citation it was bound to", () => {
    for (const item of items) {
      const all: DocSegment[] = rows.flatMap((r) => r.segments);
      const quote = all.find((s) => s.kind === "quotation" && s.itemId === item.id);
      expect(quote, `no quotation mark for ${item.id}`).toBeDefined();
      expect(quote!.start).toBe(item.quotation.span.start);
      expect(quote!.end).toBe(item.quotation.span.end);

      const cite = all.find((s) => s.kind === "citation" && s.itemId === item.id);
      expect(cite, `no citation mark for ${item.id}`).toBeDefined();
      expect(cite!.start).toBe(item.citation.span.start);

      // The row's rail lists each item exactly once, in document order.
      const rowsWithItem = rows.filter((r) => r.itemIds.includes(item.id));
      expect(rowsWithItem.length).toBe(1);
    }
  });

  it("keeps every quotation's text equal to the quotation the parser recorded", () => {
    // Whitespace-normalised on both sides: the parser records a quotation wrapped across lines.
    for (const item of items) {
      const sliced = brief.slice(item.quotation.span.start, item.quotation.span.end);
      expect(collapse(sliced)).toBe(collapse(item.quotation.raw));
    }
  });
});

describe("report: source links never claim a link they do not have", () => {
  it("links a curated case straight to its corpus file", () => {
    const link = caseSourceLink("Brown v. Board of Education", ["347 U.S. 483", "74 S. Ct. 686"]);
    expect(link.direct).toBe(true);
    expect(link.href).toBe("https://static.case.law/us/347/cases/0483-01.json");
  });

  it("reaches a case through a PARALLEL citation, not only the canonical spelling", () => {
    // A document that cites Brown as 74 S. Ct. 686 must still deep-link to the file we hold.
    const link = caseSourceLink("Brown v. Board of Education", ["74 S. Ct. 686"]);
    expect(link.direct).toBe(true);
    expect(link.href).toContain("/us/347/cases/0483-01.json");
  });

  it("falls back to a labelled search for a case with no coordinates we trust", () => {
    const link = caseSourceLink("Some Case", ["999 U.S. 1234"]);
    expect(link.direct).toBe(false);
    expect(link.href).toContain("courtlistener.com");
    expect(link.label).toContain("999 U.S. 1234");
  });

  it("has a non-empty curated index to resolve against", () => {
    // A vacuous index would make every case fall back to a search and no test would notice.
    expect(SOURCE_INDEX_SIZE).toBeGreaterThan(10);
  });
});

describe("report: the proposition comes from the drafter's own sentence", () => {
  const items = bindQuotations(parseCitations(brief), parseQuotations(brief));
  const itemFor = (fragment: string) => {
    const item = items.find((i) => collapse(i.citation.raw).includes(collapse(fragment)));
    expect(item, `no audited item citing ${fragment}`).toBeDefined();
    return item!;
  };

  it("returns the whole sentence, and does not cut it at a line break", () => {
    // The E1 line is hard-wrapped mid-quotation in the source
    // (`…held that "Separate educational\nfacilities are inherently unequal."`), which is exactly
    // the wrap the first implementation treated as a sentence end.
    const proposition = propositionFor(brief, itemFor("347 U.S. 483").quotation.span);
    expect(proposition).toContain("In Brown v. Board of Education, 347 U.S. 483, 495 (1954)");
    expect(proposition).toContain("Separate educational facilities are inherently unequal.");
    expect(proposition).not.toMatch(/\n/);
    // The sentence, not the paragraph it sits in.
    expect(proposition).not.toContain("The controlling authority");
    expect(proposition.length).toBeLessThan(400);
  });

  it("keeps the misattributed line's citation intact, wrap and abbreviation included", () => {
    const proposition = propositionFor(brief, itemFor("163 U.S. 537").quotation.span);
    expect(proposition).toContain("It was first announced in Plessy v. Ferguson, 163 U.S. 537, 544 (1896)");
    expect(proposition).not.toContain("347 U.S. 483");
    // `Plessy v. Ferguson` must not have been read as a sentence ending at "v.".
    expect(proposition.startsWith("It was first announced")).toBe(true);
  });

  it("falls back to a bounded window when there is no sentence to find", () => {
    const runOn = "a".repeat(500) + " no punctuation here at all " + "b".repeat(500);
    const proposition = propositionFor(runOn, { start: 520, end: 560 });
    // Bounded, so a pathological document cannot hand the model an unbounded prompt.
    expect(proposition.length).toBeLessThanOrEqual(MAX_PROPOSITION_CHARS);
    expect(proposition.length).toBeGreaterThan(100);
  });

  it("is stable for the same span, and different for a span in another paragraph", () => {
    const e1 = itemFor("347 U.S. 483").quotation.span;
    const e3 = itemFor("999 U.S. 1234").quotation.span;
    expect(propositionFor(brief, e1)).toBe(propositionFor(brief, e1));
    expect(propositionFor(brief, e1)).not.toBe(propositionFor(brief, e3));
  });
});

describe("report: the store is bounded and honest about a miss", () => {
  beforeEach(() => {
    // Drain the store so a bounded-map test cannot be influenced by another test's writes.
    for (let i = 0; i < MAX_REPORTS + 5; i++) putReport({ id: `drain-${i}` } as never);
  });

  it("returns the report it was given", () => {
    putReport({ id: "abc123", title: "t" } as never);
    expect(getReport("abc123")).toMatchObject({ id: "abc123", title: "t" });
  });

  it("returns null for an id it never held, including a prototype-shaped one", () => {
    expect(getReport("nope")).toBeNull();
    expect(getReport("__proto__")).toBeNull();
    expect(getReport("constructor")).toBeNull();
  });

  it("evicts the oldest rather than growing without limit", () => {
    for (let i = 0; i < MAX_REPORTS + 4; i++) putReport({ id: `id-${i}` } as never);
    expect(reportCount()).toBeLessThanOrEqual(MAX_REPORTS);
    expect(getReport("id-0")).toBeNull();
    expect(getReport(`id-${MAX_REPORTS + 3}`)).not.toBeNull();
  });

  it("keys the same document to the same id, so a deep link survives a re-run", () => {
    expect(reportId("a brief")).toBe(reportId("a brief"));
    expect(reportId("a brief")).not.toBe(reportId("a brief "));
    expect(reportId("a brief")).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("report: summarising counts what happened and nothing else", () => {
  it("starts from a full set of six verdicts at zero", () => {
    const counts = emptyCounts();
    expect(Object.keys(counts)).toHaveLength(6);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it("reports a cost of null when nothing reported one", () => {
    const s = summarise([], [{ status: "unavailable", costUsd: null } as never]);
    expect(s.belt.costUsd).toBeNull();
    expect(s.belt.unavailable).toBe(1);
    expect(s.belt.ran).toBe(false);
  });

  it("splits positive finds, accusations and refusals", () => {
    const s = summarise(
      [
        { itemId: "1", verdict: "VERIFIED", reason: "r" },
        { itemId: "2", verdict: "MISATTRIBUTED", reason: "r" },
        { itemId: "3", verdict: "FABRICATED", reason: "r" },
        { itemId: "4", verdict: "UNVERIFIABLE_COVERAGE", reason: "r" },
      ] as never,
      null,
    );
    expect(s.total).toBe(4);
    expect(s.positive).toBe(2);
    expect(s.accusations).toBe(1);
    expect(s.refusals).toBe(1);
    expect(s.belt.ran).toBe(false);
  });
});

describe("report: the document title is the document's own", () => {
  it("takes the first line when it reads like a title", () => {
    expect(documentTitle("DEFENDANT'S MOTION TO DISMISS\n\nNow comes...")).toBe(
      "DEFENDANT'S MOTION TO DISMISS",
    );
  });

  it("does not invent one from prose", () => {
    const title = documentTitle("Now comes the defendant, by counsel, and moves this Court.\n\nMore prose follows here.");
    expect(title).not.toBe("Now comes the defendant, by counsel, and moves this Court.");
    expect(title.endsWith("…")).toBe(true);
  });

  it("says so when there is nothing to title", () => {
    expect(documentTitle("   \n\n  ")).toBe("Untitled document");
  });
});

describe("report: a real audit produces a renderable report", () => {
  it(
    "audits the fixture brief to the five ground-truth verdicts, belt off",
    async () => {
      const { bundle, itemsFound } = await runAudit(brief, { belt: false });

      expect(itemsFound).toBe(5);
      expect(bundle.summary.total).toBe(5);
      expect(bundle.summary.counts).toMatchObject({
        VERIFIED: 1,
        MISATTRIBUTED: 1,
        FABRICATED: 1,
        UNVERIFIABLE_COVERAGE: 1,
        UNVERIFIABLE_LOW_CONFIDENCE: 1,
      });
      expect(bundle.items.every((i) => i.reason.trim().length > 0)).toBe(true);

      // The report is retrievable by the id the API hands back — the whole point of the store.
      expect(getReport(bundle.id)).not.toBeNull();

      // The belt is off, so the page must be able to say the belt did not run rather than implying
      // the model found nothing.
      expect(bundle.summary.belt.ran).toBe(false);

      const verified = bundle.items.find((i) => i.verdict === "VERIFIED")!;
      expect(verified.excerptSide).toBe("cited");
      expect(verified.excerpt?.match).toContain("Separate educational facilities are inherently unequal.");
      expect(verified.opinionSpan).toEqual({ start: 9564, end: 9619 });
      expect(verified.citedCase?.source.direct).toBe(true);

      const misattributed = bundle.items.find((i) => i.verdict === "MISATTRIBUTED")!;
      // The excerpt follows the offsets: MISATTRIBUTED deep-links to the TRUE HOME, not the cited case.
      expect(misattributed.excerptSide).toBe("trueHome");
      expect(misattributed.trueHome?.citation).toBe("347 U.S. 483");
      expect(misattributed.excerpt?.match).toContain("Separate educational facilities are inherently unequal.");
      expect(misattributed.trueHomeCandidates.length).toBeGreaterThan(1);

      const fabricated = bundle.items.find((i) => i.verdict === "FABRICATED")!;
      expect(fabricated.opinionSpan).toBeNull();
      expect(fabricated.excerpt).toBeNull();
      expect(fabricated.trace.length).toBeGreaterThan(0);
      expect(fabricated.belt).toBeNull();

      // Every item on the page is reachable from the document: a row lists it, and its rail entry
      // exists. An item with no rail entry would be a verdict with no place on the page.
      for (const item of bundle.items) {
        expect(bundle.rows.some((r) => r.itemIds.includes(item.id))).toBe(true);
      }
    },
    // The engine reads cached fixtures and issues no requests here; the generous ceiling is for a
    // machine under memory pressure, not for the work itself.
    60_000,
  );

  it("builds a report object that is JSON-serialisable end to end", async () => {
    const { bundle } = await runAudit(brief, { belt: false });
    // The audit must never produce something the server cannot hand to a component.
    expect(() => JSON.parse(JSON.stringify(bundle))).not.toThrow();
  }, 60_000);
});
