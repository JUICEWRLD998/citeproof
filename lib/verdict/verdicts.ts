import type { Span, Verdict } from "../types";
import { assessConfidence } from "./ocr";

/**
 * The verdict precedence rule, as a pure function.
 *
 * `fixtures/ground-truth.json` fixes the order, and it is not arbitrary — swapping any two rules
 * changes a ground-truth verdict:
 *
 *   1. quotation FOUND in the cited case          -> VERIFIED            (even at low OCR confidence)
 *   2. quotation FOUND in a DIFFERENT case        -> MISATTRIBUTED       (a positive find wins)
 *   3. ABSENT, cited OCR <  OCR_CONFIDENCE_FLOOR  -> UNVERIFIABLE_LOW_CONFIDENCE
 *   4. ABSENT, citation past the corpus boundary  -> UNVERIFIABLE_COVERAGE
 *   5. ABSENT, in coverage, confidence adequate   -> FABRICATED
 *
 * Two orderings carry the product's whole argument:
 *
 * - **Rule 1 before rule 3.** Brown v. Board's own OCR is 0.664, below the 0.5 floor. If the
 *   confidence gate ran first, the flagship VERIFIED verdict on the most famous holding in
 *   American constitutional law would be unreachable — the tool would refuse to confirm a
 *   quotation it had just located verbatim.
 * - **Rule 2 before rule 3.** E2 cites Plessy, whose OCR is 0.434, also below the floor. The
 *   quotation is genuinely elsewhere. Because finding it elsewhere is a POSITIVE result, it
 *   outranks the low-confidence gate, which exists to suppress *unsupported accusations* rather
 *   than to suppress evidence.
 *
 * This file is pure: it takes facts and returns a verdict with a reason. It reads no disk and
 * makes no request, so every ordering above is testable in isolation.
 */

/** What the matcher found where. `null` means "could not be established", never "absent". */
export interface MatchFacts {
  /** FOUND verbatim in the cited case. */
  foundInCited: Span | null;
  /** Whether the cited case's record carries no opinion body at all (E6). */
  citedOpinionBodyMissing: boolean;
  /** FOUND in some other case, with an EXACT normalised match. */
  trueHome: { citation: string; caseName: string; span: Span } | null;
  /** OCR confidence of the cited case. */
  citedConfidence: number;
}

/** What the cascade established about reachability. See lib/resolve/cascade.ts. */
export type Reachability =
  | { kind: "reachable" }
  /** We cannot adjudicate. Every variant here is a refusal, never an accusation. */
  | { kind: "refused"; why: string; reason: string; isCoverage: boolean }
  /**
   * The citation is INSIDE coverage, and the volume index we searched was substantive (non-empty)
   * and carried no case claiming that citation.
   *
   * Split out from `refused` in Phase 4 because the two err in opposite directions. Treating it as
   * a refusal misses the fabricated-citation case the product exists to catch — a citation naming
   * a volume the corpus holds and matching nothing in it. Treating EVERY unresolved citation as an
   * accusation instead would be worse: a truncated, empty or failed volume index looks identical
   * to "no such case" at the call site, and `lib/corpus/cache.ts` explicitly warns that the index is
   * the layer to distrust first. So the distinction is made on EVIDENCE — how many records were
   * actually available to search — and an empty index never accuses.
   */
  | { kind: "unresolved-substantive"; reason: string; indexSize: number }
  /**
   * The citation could not have existed as dated — the OTHER non-refusal that permits an
   * accusation, and it comes from the measured volume projection.
   */
  | { kind: "implausible"; reason: string }
  /** Several real cases share the citation; adjudicating would pick one arbitrarily. */
  | { kind: "ambiguous"; reason: string; candidates: string[] };

export interface VerdictDecision {
  verdict: Verdict;
  reason: string;
}

export function decideVerdict(reach: Reachability, facts: MatchFacts | null): VerdictDecision {
  switch (reach.kind) {
    case "implausible":
      // Rule 5 reached structurally rather than by absence: the citation itself could not exist at
      // the date it asserts, so there is nothing to search. This is the E3 path.
      return {
        verdict: "FABRICATED",
        reason: `${reach.reason}. No opinion could contain it, so the quotation's text is not the question.`,
      };

    case "unresolved-substantive":
      // Rule 5 reached structurally in the other direction: the volume EXISTS, we read its index,
      // and no record claims this citation. NOTE the reason does not rest on the quotation at all,
      // because there is no opinion text to search — the accusation is about the CITATION's
      // non-existence. That distinction is why this cannot be folded into the plain absence path.
      return {
        verdict: "FABRICATED",
        reason:
          `${reach.reason}. The volume index held ${reach.indexSize} record(s) and none of them claims ` +
          `this citation, so no opinion text exists to search — the finding is that the citation names ` +
          `nothing, not merely that the quotation is absent from it.`,
      };

    case "ambiguous":
      // Refuse. Measured in us/572: 803 of 893 cites are shared by DIFFERENT cases (orders lists),
      // so adjudicating means picking one real case arbitrarily — the silent misattribution this
      // product exists to expose. Ambiguity is a reason to refuse, never to accuse.
      return {
        verdict: "UNVERIFIABLE_UNRESOLVED",
        reason: `${reach.reason}. ${reach.candidates.length} candidates: ${reach.candidates.slice(0, 3).join("; ")}${reach.candidates.length > 3 ? `; +${reach.candidates.length - 3} more` : ""}. Refusing to adjudicate rather than pick one.`,
      };

    case "refused":
      return {
        verdict: reach.isCoverage ? "UNVERIFIABLE_COVERAGE" : "UNVERIFIABLE_UNRESOLVED",
        reason: reach.reason,
      };

    case "reachable":
      break;
  }

  if (!facts) {
    // Unreachable in practice: a reachable citation always yields facts. Returning a refusal
    // rather than an accusation is the safe default if that ever stops being true.
    return {
      verdict: "UNVERIFIABLE_UNRESOLVED",
      reason: "the citation resolved but no comparison was performed, so nothing can be concluded",
    };
  }

  // Rule 1. A find always wins, whatever the confidence and whatever the record's condition.
  if (facts.foundInCited) {
    return {
      verdict: "VERIFIED",
      reason:
        `the quotation is present in the cited case, verbatim after normalisation, at chars ` +
        `${facts.foundInCited.start}–${facts.foundInCited.end} of its opinion text` +
        (facts.citedConfidence < 0.5
          ? `. The case's OCR confidence is ${facts.citedConfidence.toFixed(3)}, below the ${0.5} floor, but a positive find is not suppressed by low confidence`
          : `. The case's OCR confidence is ${facts.citedConfidence.toFixed(3)}`),
    };
  }

  // E6. A record with NO opinion body cannot ground an accusation: the part we would have searched
  // is precisely the part that is missing. This MUST sit before rules 3–5, because reaching rule 5
  // from here would accuse a case on the strength of text we never had.
  if (facts.citedOpinionBodyMissing) {
    return {
      verdict: "UNVERIFIABLE_UNRESOLVED",
      reason:
        `the cited case resolves, but its corpus record carries no opinion body — only head_matter. ` +
        `The quotation was not found in the text that is present, and the text that is missing is ` +
        `the part that would have contained it, so absence here is not evidence of fabrication.`,
    };
  }

  // Rule 2. A positive find elsewhere outranks the low-confidence gate below.
  if (facts.trueHome) {
    return {
      verdict: "MISATTRIBUTED",
      reason:
        `the quotation is NOT in the cited case, but it is present verbatim in ${facts.trueHome.caseName} ` +
        `(${facts.trueHome.citation}) at chars ${facts.trueHome.span.start}–${facts.trueHome.span.end}. ` +
        `The sentence is real; it is attributed to the wrong case.`,
    };
  }

  // Rule 3. Low confidence suppresses ACCUSATIONS ONLY.
  const confidence = assessConfidence(facts.citedConfidence, false);
  if (confidence.kind === "too-low-to-accuse") {
    return {
      verdict: "UNVERIFIABLE_LOW_CONFIDENCE",
      reason:
        `the quotation is absent from the cited case, whose OCR confidence is ` +
        `${facts.citedConfidence.toFixed(3)} — below the ${confidence.floor} floor. That is not high ` +
        `enough to call this a fabrication, so we do not.`,
    };
  }

  // Rule 5. Absent, in coverage, text trustworthy enough to rely on absence.
  return {
    verdict: "FABRICATED",
    reason:
      `the citation resolves to a real case whose opinion text is complete and readable ` +
      `(OCR confidence ${facts.citedConfidence.toFixed(3)}), and the quotation appears nowhere in it. ` +
      `The text that would have contained it is present, so its absence is evidence.`,
  };
}

/** Reason for a quotation that never got a citation, kept beside the rules it bypasses. */
export const NO_CITATION_REASON =
  "the quotation is not attributed to any citation, so there is nothing to check it against. " +
  "This is reported as unresolved rather than fabricated: an unattributed quotation is a drafting " +
  "problem, not a fabricated citation.";
