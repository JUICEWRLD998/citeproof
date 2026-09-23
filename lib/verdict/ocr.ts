import { OCR_CONFIDENCE_FLOOR } from "../types";

/**
 * The OCR-confidence gate. One-directional, and the direction is the whole design.
 *
 *   FOUND  + any confidence        -> a positive verdict is available (VERIFIED / MISATTRIBUTED)
 *   ABSENT + confidence <  FLOOR   -> UNVERIFIABLE_LOW_CONFIDENCE — refuse to accuse
 *   ABSENT + confidence >= FLOOR   -> an accusation is available (FABRICATED)
 *
 * ## Why the gate is NOT symmetric
 *
 * A symmetric gate — "low confidence means say UNVERIFIABLE" — sounds more cautious and is in
 * fact the more dangerous design. Brown v. Board of Education measures `ocr_confidence: 0.664`,
 * below this floor. Under a symmetric gate the flagship VERIFIED verdict on the most famous
 * holding in American constitutional law becomes UNREACHABLE: the tool would refuse to confirm a
 * quotation it had just found verbatim. Confidence is a statement about how much we trust the
 * TEXT WE HOLD, so it can only ever weaken an inference that DEPENDS on the text being absent.
 * A find does not depend on absence, so it is untouched.
 *
 * ## Why the floor is a number and not a vibe
 *
 * `implementation.md` Phase 4 warns that "the OCR gate must be a *threshold with a recorded
 * number*, not a vibe. If it silently flips verdicts the honesty layer is theatre." The number
 * lives in one place — `OCR_CONFIDENCE_FLOOR` in lib/types.ts, re-exported below — with its two
 * measured anchors recorded beside it: Plessy 0.434 refuses to accuse, Brown 0.664 may accuse.
 * 0.5 is the midpoint of those anchors, NOT a statistically derived value, and it is a known-open
 * parameter. `tests/verdicts.test.ts` pins the boundary from both sides so a silent change to it
 * fails the build.
 *
 * ## This is a post-hoc GATE, not a text-quality estimate
 *
 * The corpus reports one `ocr_confidence` per case, not per span, so a degraded span inside an
 * otherwise-clean opinion cannot be detected here. That is a real limitation and it is recorded
 * in docs/LIMITS.md rather than papered over with a span-level heuristic we cannot measure.
 */

export { OCR_CONFIDENCE_FLOOR };

export type ConfidenceDecision =
  /** The quotation was located. Confidence is recorded but cannot change this. */
  | { kind: "found"; confidence: number }
  /** Absent, and confidence is too low to support an accusation. Refuse. */
  | { kind: "too-low-to-accuse"; confidence: number; floor: number }
  /** Absent, and confidence is adequate. An accusation is permissible. */
  | { kind: "may-accuse"; confidence: number; floor: number };

/**
 * Decide what the corpus's stated confidence permits, given whether the quotation was found.
 *
 * `found` is passed in rather than computed here so this module stays a pure predicate over two
 * facts: did we find it, and how much do we trust the text. Keeping those separate is what makes
 * the one-directional rule auditable.
 */
export function assessConfidence(
  confidence: number,
  found: boolean,
  floor: number = OCR_CONFIDENCE_FLOOR,
): ConfidenceDecision {
  if (found) return { kind: "found", confidence };
  if (confidence < floor) return { kind: "too-low-to-accuse", confidence, floor };
  return { kind: "may-accuse", confidence, floor };
}

/**
 * Is a case's text degraded enough that we must not accuse on its absence alone?
 *
 * A missing measurement is NOT treated as low quality. `parseCasePayload` defaults a missing
 * `ocr_confidence` to 1, and this predicate inherits that direction: absence of evidence about
 * text quality must not be read as evidence of poor text quality, or every un-analysed case would
 * become un-accusable and the tool could never report a fabrication at all.
 */
export function isTextDegraded(confidence: number, floor: number = OCR_CONFIDENCE_FLOOR): boolean {
  return confidence < floor;
}

/** Human-readable badge for the report. The percentage is what the demo shows on screen. */
export function confidenceLabel(confidence: number): string {
  return `${(confidence * 100).toFixed(0)}% OCR`;
}
