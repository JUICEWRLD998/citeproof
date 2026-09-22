import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditItem, Verdict } from "../lib/types";
import { auditItem } from "../lib/verdict";
import { findAllQuotes, normalize } from "../lib/match";

const root = process.cwd();
const brief = readFileSync(join(root, "fixtures/briefs/motion-to-dismiss.txt"), "utf8");
const gt = JSON.parse(readFileSync(join(root, "fixtures/ground-truth.json"), "utf8"));

interface Expectation {
  id: string;
  why: string;
  citationRaw: string;
  pincite?: number;
  caseName: string;
  quote: string;
  expectedVerdict: Verdict;
  expectedTrueHome?: string;
  status?: string;
}

/**
 * Build an AuditItem from ground truth without depending on the PARSER (Phase 2). That
 * independence is the point: the expected verdicts must come from the fixture, not from the
 * implementation under test.
 *
 * It does use the Phase 2 MATCHER to locate the quotation, and that is a correction rather than a
 * convenience. The previous version used `brief.indexOf(e.quote)`, which returns **-1 for every
 * expectation in this file**: `fixtures/ground-truth.json` stores its quotations in
 * whitespace-normalised form, while the brief wraps them across lines ("Separate educational\n
 * facilities are inherently unequal."). The result was a silent `span: {start: 0, end: 0}` on
 * every item. It went unnoticed only because `auditItem` was still `NotImplemented`, so the span
 * was never read — it would have surfaced in Phase 4 as `foundInDocument` pointing at the start of
 * the document.
 *
 * Occurrence disambiguation: E1 and E2 quote the SAME sentence, and the brief contains it twice.
 * The first occurrence is the wrong answer for E2, so duplicates are resolved by document order,
 * which matches the order the expectations are written in.
 */
function itemFrom(e: Expectation, occurrence: number): AuditItem {
  const spans = findAllQuotes(brief, e.quote);
  const span = spans[occurrence] ?? { start: 0, end: 0 };
  return {
    id: e.id,
    citation: {
      raw: e.citationRaw,
      volume: Number(e.citationRaw.split(" ")[0]),
      reporter: e.citationRaw.split(" ")[1],
      page: Number((e.citationRaw.split(" ")[2] ?? "").replace(/[^0-9]/g, "")),
      pincite: e.pincite,
      span: { start: 0, end: 0 },
      shortForm: false,
    },
    quotation: {
      // The brief's ACTUAL bytes, so `raw` and `span` agree with each other.
      raw: span.start === span.end ? e.quote : brief.slice(span.start, span.end),
      span,
    },
  };
}

/** Ordinal of this expectation among those quoting the same sentence. */
function occurrenceOf(e: Expectation, all: Expectation[]): number {
  return all.filter((x) => x.id !== e.id && normalize(x.quote) === normalize(e.quote)).length
    ? all
        .slice(0, all.findIndex((x) => x.id === e.id))
        .filter((x) => normalize(x.quote) === normalize(e.quote)).length
    : 0;
}

const expectations: Expectation[] = (gt.expectations as Expectation[]).filter(
  // Anything still pending — whether on a source or on a definition — is excluded, so the
  // suite names the gap rather than failing on an expectation nobody has settled yet.
  (e) => !e.status?.startsWith("PENDING"),
);

describe("ground truth verdicts (fixtures/ground-truth.json)", () => {
  it("has at least one expectation of every verdict kind it claims to cover", () => {
    const kinds = new Set(expectations.map((e) => e.expectedVerdict));
    // The four verdicts the product promises. If this shrinks, the demo shrank.
    for (const k of ["VERIFIED", "MISATTRIBUTED", "FABRICATED"]) {
      expect(kinds.has(k as Verdict), `ground truth no longer covers ${k}`).toBe(true);
    }
    expect(
      [...kinds].some((k) => k.startsWith("UNVERIFIABLE_")),
      "ground truth no longer covers any UNVERIFIABLE branch",
    ).toBe(true);
  });

  for (const e of expectations) {
    const item = () => itemFrom(e, occurrenceOf(e, expectations));
    describe(`${e.id} — ${e.caseName} (expect ${e.expectedVerdict})`, () => {
      it("locates its quotation in the brief before anything else runs", () => {
        // A guard, not a formality. Without it a quotation that was not found silently produces a
        // zero-length span and every later assertion tests the wrong thing.
        const built = item();
        expect(built.quotation.span.end, `${e.id} quotation not located in the brief`).toBeGreaterThan(
          built.quotation.span.start,
        );
        expect(brief.slice(built.quotation.span.start, built.quotation.span.end)).toBe(built.quotation.raw);
      });

      it(`returns ${e.expectedVerdict}`, async () => {
        const result = await auditItem(item());
        expect(result.verdict).toBe(e.expectedVerdict);
      });

      it("carries a non-empty reason", async () => {
        const result = await auditItem(item());
        expect(result.reason.trim().length).toBeGreaterThan(0);
      });

      if (e.expectedVerdict === "VERIFIED" || e.expectedVerdict === "MISATTRIBUTED") {
        it("reports where in the opinion the quotation was found", async () => {
          const result = await auditItem(item());
          expect(result.foundInOpinion).toBeDefined();
          expect(result.foundInOpinion!.end).toBeGreaterThan(result.foundInOpinion!.start);
        });
      }

      if (e.expectedTrueHome) {
        it(`names ${e.expectedTrueHome} as the true home`, async () => {
          const result = await auditItem(item());
          expect(result.trueHome?.citation).toBe(e.expectedTrueHome);
        });
      }
    });
  }

  // Registered so the gap shows in CI output instead of being silently absent.
  // The SOURCE is now found — 392 F. Supp. 3d 138, Intellectual Ventures I v. Lenovo, whose
  // majority opinion is empty. What is unresolved is the DEFINITION: whether a record with an
  // empty `opinions` array but 6,397 chars of `head_matter` counts as carrying no text. That
  // choice needs a threshold with a recorded number. See docs/LIMITS.md section 4.
  it.todo("E6 — UNVERIFIABLE_UNRESOLVED: case resolves but carries no casebody text");
});
