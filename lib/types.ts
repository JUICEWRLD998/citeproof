/**
 * Shared contract for CiteProof.
 *
 * These types are frozen in Phase 0 and are the interface every later phase
 * implements. Changing a verdict name here means changing fixtures/ground-truth.json
 * and the UI together — that is deliberate friction, because the verdict vocabulary
 * is the product.
 */

/**
 * Six values, not four. The original design had one UNVERIFIABLE; recon showed the
 * reasons are different and a lawyer needs to know WHICH. Collapsing them back to one
 * loses the honesty layer's information.
 */
export type Verdict =
  | "VERIFIED"
  | "MISATTRIBUTED"
  | "FABRICATED"
  | "UNVERIFIABLE_COVERAGE"
  | "UNVERIFIABLE_LOW_CONFIDENCE"
  | "UNVERIFIABLE_UNRESOLVED";

export const ACCUSATORY: readonly Verdict[] = ["FABRICATED"];
export const NON_ACCUSATORY: readonly Verdict[] = [
  "VERIFIED",
  "MISATTRIBUTED",
  "UNVERIFIABLE_COVERAGE",
  "UNVERIFIABLE_LOW_CONFIDENCE",
  "UNVERIFIABLE_UNRESOLVED",
];

/** A character range in the ORIGINAL, un-normalised string. */
export interface Span {
  start: number;
  end: number;
}

export interface Citation {
  /** Exactly as it appeared in the document. */
  raw: string;
  volume: number;
  reporter: string;
  page: number;
  /** e.g. "at 495" -> 495 */
  pincite?: number;
  year?: number;
  /** Offsets into the source document. */
  span: Span;
  /** True when this citation was carried forward from a prior full cite (Id., supra). */
  shortForm: boolean;
}

export interface Quotation {
  raw: string;
  span: Span;
  /** The citation this quotation is attributed to, if the parser could bind one. */
  attributedTo?: Citation;
}

/** One unit of work: a quotation attributed to a citation. */
export interface AuditItem {
  id: string;
  citation: Citation;
  quotation: Quotation;
}

/** How a case was located. Recorded because it is demo evidence, not debug output. */
export interface ResolutionStep {
  source: "cap-metadata" | "cap-case" | "courtlistener-search" | "cache";
  query: string;
  outcome: "hit" | "miss" | "error" | "skipped";
  detail?: string;
}

export interface ResolvedCase {
  /** Canonical citation string, e.g. "347 U.S. 483". */
  citation: string;
  caseName: string;
  caseNameFull: string;
  decisionDate: string; // ISO yyyy-mm-dd
  court: string;
  /** Every parallel/vendor citation the corpus records. */
  allCitations: string[];
  /** sha256 from the corpus analysis block; also the cache key. */
  sha256: string;
  /** 0..1. Low values gate verdicts toward UNVERIFIABLE_LOW_CONFIDENCE. */
  ocrConfidence: number;
  /** Verbatim opinion text, opinions joined in order. */
  text: string;
}

export interface AuditResult {
  itemId: string;
  verdict: Verdict;
  /** Human-readable, courtroom-safe reason. Never empty. */
  reason: string;
  /** Where the quotation was found, in the RESOLVED opinion text. */
  foundInOpinion?: Span;
  /** Where the quotation was found, in the USER'S document. */
  foundInDocument?: Span;
  /** Set only for MISATTRIBUTED: the case the sentence actually lives in. */
  trueHome?: ResolvedCase;
  /** The case the document cited. */
  citedCase?: ResolvedCase;
  /** Only computed when verbose; the demo renders this. */
  resolutionTrace?: ResolutionStep[];
}

/** Thrown by the corpus layer when a citation resolves to nothing. Not a verdict. */
export type CorpusError =
  | { kind: "OutOfCoverage"; message: string; boundary: string }
  | { kind: "Unresolved"; message: string }
  /**
   * Added in Phase 1 after a MEASURED finding, because collapsing it into "Unresolved" would
   * have been a correctness bug, not a simplification.
   *
   * Exact `citations[].cite` matching is NOT unique in CAP. Measured in `us/572`
   * (`.recon/probe-cite-ambiguity.mjs`): 803 of 893 distinct cites are claimed by more than
   * one record, max 27. The collisions are DIFFERENT cases sharing a page number — Supreme
   * Court orders lists print many short dispositions on one page, one record each
   * (`1082-01`, `1082-02`, ...). So `572 U.S. 1110` legitimately matches 13 different cases.
   *
   * This must not be "Unresolved": by the precedence rule an unresolved-but-in-coverage
   * citation becomes FABRICATED, which would mean the tool accusing a real case because two
   * real cases share a page. Ambiguity is a reason to refuse to adjudicate, never to accuse.
   */
  | { kind: "Ambiguous"; message: string; candidates: string[] }
  | { kind: "Network"; message: string }
  | { kind: "NotImplemented"; message: string };

/**
 * Low OCR-confidence threshold, applied one-directionally:
 *
 *   FOUND  + any confidence      -> positive verdict (VERIFIED / MISATTRIBUTED)
 *   ABSENT + confidence <  FLOOR -> UNVERIFIABLE_LOW_CONFIDENCE (do not accuse)
 *   ABSENT + confidence >= FLOOR -> FABRICATED / MISATTRIBUTED
 *
 * Low confidence suppresses ACCUSATIONS only. It must never suppress a positive find:
 * Brown v. Board itself measures 0.664, so a symmetric gate would make the flagship
 * VERIFIED verdict unreachable — the tool would refuse to confirm the single most
 * famous holding in American constitutional law.
 *
 * Calibrated from two measured anchors in the corpus (see docs/LIMITS.md):
 *   Plessy v. Ferguson   ocr_confidence 0.434  -> refuses to accuse
 *   Brown v. Board       ocr_confidence 0.664  -> may accuse
 * 0.5 is the midpoint of those anchors, NOT a statistically derived value. It is a
 * known-open parameter: recalibrate on a larger sample before trusting it in production.
 */
export const OCR_CONFIDENCE_FLOOR = 0.5;

/**
 * Fuzzy token-alignment similarity required before a near-match counts as found.
 */
export const FUZZY_MATCH_THRESHOLD = 0.92;
