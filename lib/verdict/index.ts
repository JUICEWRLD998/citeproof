import type { AuditItem, AuditResult } from "../types";

function notImplemented(what: string): never {
  throw new Error(`${what} is not implemented yet — see implementation.md Phase 4.`);
}

/**
 * Adjudicate one item. Precedence is fixed and tested (fixtures/ground-truth.json):
 *
 *   1. quotation FOUND in the cited case        -> VERIFIED          (even at low OCR confidence)
 *   2. quotation FOUND in a different case      -> MISATTRIBUTED     (positive find wins)
 *   3. ABSENT, cited OCR <  OCR_CONFIDENCE_FLOOR-> UNVERIFIABLE_LOW_CONFIDENCE
 *   4. ABSENT, citation past corpus boundary    -> UNVERIFIABLE_COVERAGE
 *   5. ABSENT, in coverage, confidence adequate -> FABRICATED
 *
 * Every verdict must carry a non-empty `reason`. An empty reason is a bug.
 */
export async function auditItem(_item: AuditItem): Promise<AuditResult> {
  return notImplemented("auditItem");
}
