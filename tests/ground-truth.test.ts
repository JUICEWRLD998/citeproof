import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditItem, Verdict } from "../lib/types";
import { auditItem } from "../lib/verdict";

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

/** Build an AuditItem from ground truth without depending on the parser (Phase 2). */
function itemFrom(e: Expectation): AuditItem {
  const raw = `${e.citationRaw}, ${e.pincite ?? ""}`;
  const start = brief.indexOf(e.quote);
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
      raw: e.quote,
      span: start >= 0 ? { start, end: start + e.quote.length } : { start: 0, end: 0 },
    },
  };
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
    describe(`${e.id} — ${e.caseName} (expect ${e.expectedVerdict})`, () => {
      it(`returns ${e.expectedVerdict}`, async () => {
        const result = await auditItem(itemFrom(e));
        expect(result.verdict).toBe(e.expectedVerdict);
      });

      it("carries a non-empty reason", async () => {
        const result = await auditItem(itemFrom(e));
        expect(result.reason.trim().length).toBeGreaterThan(0);
      });

      if (e.expectedVerdict === "VERIFIED" || e.expectedVerdict === "MISATTRIBUTED") {
        it("reports where in the opinion the quotation was found", async () => {
          const result = await auditItem(itemFrom(e));
          expect(result.foundInOpinion).toBeDefined();
          expect(result.foundInOpinion!.end).toBeGreaterThan(result.foundInOpinion!.start);
        });
      }

      if (e.expectedTrueHome) {
        it(`names ${e.expectedTrueHome} as the true home`, async () => {
          const result = await auditItem(itemFrom(e));
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
