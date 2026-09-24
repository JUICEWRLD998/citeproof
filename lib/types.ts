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

/**
 * Why a citation is out of corpus coverage.
 *
 * Defined here, in the frozen contract, rather than in the implementation that computes it,
 * because downstream verdict logic branches on it: `volume-implausible-for-year` is the ONE
 * reason that is a positive structural claim rather than a refusal. Every other value means
 * "we cannot reach it" and must never produce an accusation.
 */
export type OutOfCoverageWhy =
  | "reporter-not-mapped"
  | "volume-beyond-corpus"
  | "page-beyond-volume"
  | "decision-date-beyond-corpus"
  | "volume-implausible-for-year";

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
  /** Verbatim opinion text, opinions joined in order, then head_matter. */
  text: string;
  /**
   * True when the corpus record carries NO opinion body — `casebody.opinions` is empty or
   * holds no non-whitespace text.
   *
   * Added in Phase 1 from a measured finding, not from speculation. `.recon/probe-e6.mjs`
   * swept 152 cases across 13 reporters and found the condition is real and not rare: in
   * `us/572` alone, 41 of 48 sampled records have empty `opinions` — they are the Supreme
   * Court's orders lists, where each short disposition is a separate record with a docket
   * line and no opinion text.
   *
   * Phase 4 MUST consult this before returning FABRICATED. A quotation absent from a record
   * with no opinion body cannot be called fabricated, because the part we would have searched
   * is precisely the part that is missing. Absent here means UNVERIFIABLE_UNRESOLVED.
   *
   * This is a FLAG, not a thrown error, and deliberately so: the CASE resolves perfectly well
   * and the UI still needs its name and citation to show. Throwing would also be unsafe —
   * a resolved-but-in-coverage failure that reaches the precedence rule as "unresolved" would
   * be reported as FABRICATED, i.e. as an accusation. E6's own test is registered as
   * "case resolves but carries no casebody text", which is this flag.
   *
   * `text` may still be non-empty when this is true: `head_matter` holds the caption, and its
   * length varies enormously. Re-verified at source 2026-09-22: `392 F. Supp. 3d 138`
   * (Intellectual Ventures I v. Lenovo, D. Mass.) has one majority opinion with an empty text
   * and 6,397 chars of `head_matter`. A sweep of 56 empty-opinion records measured the
   * distribution as bimodal — docket-only captions clustered at 132..309 chars, then a gap, then
   * 539 / 648 / 685, then 6,397 — but NO threshold has been chosen from it and this file does
   * not set one. The matcher searches all of `text`, so a quotation found in `head_matter` still
   * yields VERIFIED; a positive find always wins. This flag only governs what to do when the
   * quotation is NOT found, and that decision is tracked as an open question in docs/LIMITS.md
   * rather than guessed at here.
   */
  opinionBodyMissing: boolean;
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
  /**
   * Every case in the local corpus containing the quotation verbatim, best-first, when the
   * verdict is MISATTRIBUTED.
   *
   * Added in Phase 5, because ranking the candidates is the resolver's real job and the reader
   * deserves to see the competition rather than a single assertion. Measured: CourtListener
   * reports **123 cases** containing Brown's holding, so naming one home with no candidates beside
   * it would hide the fact that a sentence has many homes and only one origin. `trueHome` is the
   * first entry; the rest are the quoters that lost.
   */
  trueHomeCandidates?: ResolvedCase[];
  /** The case the document cited. */
  citedCase?: ResolvedCase;
  /** Only computed when verbose; the demo renders this. */
  resolutionTrace?: ResolutionStep[];
}

/** Thrown by the corpus layer when a citation resolves to nothing. Not a verdict. */
export type CorpusError =
  /**
   * `why` is machine-readable and load-bearing, added in Phase 3. The cascade must tell
   * `volume-implausible-for-year` (a positive structural claim, measured against a recorder
   * bound — the only out-of-coverage reason that can lead to FABRICATED) apart from every other
   * reason, which is a refusal and must never accuse. Branching on this string rather than on
   * the prose in `boundary` is deliberate: prose is for the human reading the receipt.
   */
  | {
      kind: "OutOfCoverage";
      message: string;
      boundary: string;
      why: OutOfCoverageWhy;
      /** Present only for `volume-implausible-for-year`; the receipt's numbers. */
      projection?: { ratio: number; bound: number; projectedVolume: number; atYear: number };
    }
  | {
      kind: "Unresolved";
      message: string;
      /**
       * How many records the volume index we searched actually held.
       *
       * Added in Phase 4, and it is verdict-deciding rather than diagnostic. The precedence rule
       * says an ABSENT quotation for an in-coverage citation is FABRICATED — a citation that names
       * a volume we hold and matches no record in it is exactly the fabricated-citation case the
       * product exists to catch. But `lib/corpus/cache.ts` warns that the volume index is the layer
       * to distrust first, and an EMPTY index is the shape a truncated or failed fetch leaves
       * behind. An empty index is evidence about our fetch, not about the law, so the two must be
       * told apart: a substantive index with no match supports an accusation; an empty one does not.
       *
       * `0` here means "we obtained no usable index" and must never become an accusation.
       */
      indexSize: number;
    }
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

/**
 * How many records a volume index must hold before its LACK of a match counts as evidence that the
 * citation names nothing real.
 *
 * Added in Phase 4. The precedence rule says an in-coverage citation with no matching case is
 * FABRICATED, and that is the fabricated-citation case the product exists to catch. But a volume
 * index is the one thing in this pipeline we fetch wholesale and cache, and `lib/corpus/cache.ts`
 * warns it is the layer to distrust first: a truncated or failed fetch leaves an index that is
 * empty or nearly so, which at the call site is indistinguishable from "no such case".
 *
 * So emptiness is only evidence above a floor. A real CAP volume index holds hundreds of records;
 * an index holding one or two is far more likely to be a truncated fetch than a genuinely tiny
 * volume, and the two errors are not symmetric — refusing a fabricated citation is a safe miss,
 * accusing a real one is the worst outcome available. Hence 3, chosen on that asymmetry exactly as
 * `OCR_CONFIDENCE_FLOOR` is, and NOT statistically derived. Both are known-open parameters.
 */
export const MIN_INDEX_FOR_ACCUSATION = 3;

/**
 * How many consecutive words a rejected belt proposal must share with the opinion before the
 * rejection is described as "the model drew on a real passage" rather than "the model invented text".
 *
 * Added in Phase 6, and it replaces a diagnostic that measurement showed to be worthless. The first
 * version compared the proposal's best alignment SIMILARITY against the opinion, and
 * `.recon/probe-belt-diagnostics.mjs` measured that it separates nothing: a real sentence the model
 * EXTENDED with extra words scored **0.400** — exactly the same as a fully invented sentence — while
 * nothing realistic reached the 0.92 floor at all, leaving the "paraphrased" branch as dead code.
 *
 * The longest contiguous verbatim run does separate them, because it measures reproduction rather
 * than resemblance. Measured, on the same probe:
 *
 *   real holding quoted exactly     6/6 words  → 1.000
 *   real quote + model's own intro  12/17      → 0.706
 *   real quote + trailing comment    5/15      → 0.333
 *   reworded real sentence           2/8       → 0.250
 *   invented sentence                2/10      → 0.200
 *   invented (damages)               2/12      → 0.167
 *   a different opinion's sentence   2/12      → 0.167
 *
 * Real reproduction therefore starts at 5 words and incidental overlap stops at 2, so **4** sits in
 * the empty gap with a word of margin on the incidental side. Short of 4 shared words, the honest
 * description is that the text appears nowhere in the opinion.
 *
 * There is one ambiguous case and it is stated rather than hidden: a model that quotes a genuine
 * short phrase — *"no genuine issue of material fact"*, 6 words — and builds a false sentence around
 * it shares 6 words with a DIFFERENT opinion's text and 2 with this one, so it is correctly called
 * invention here. The boundary is genuinely murky, which is exactly why this number decides only how
 * a rejection is DESCRIBED and never whether a span is accepted.
 */
export const MIN_VERBATIM_RUN_TOKENS = 4;
