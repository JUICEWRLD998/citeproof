import type { AuditItem, AuditResult, ResolvedCase } from "../types";
import { MIN_INDEX_FOR_ACCUSATION } from "../types";
import { findBestMatch } from "../match";
import { findTrueHome } from "../match/misattribution";
import type { CachePaths } from "../corpus/cache";
import { resolveCitation, type CascadeOptions, type CascadeOutcome } from "../resolve/cascade";
import { decideVerdict, NO_CITATION_REASON, type MatchFacts, type Reachability } from "./verdicts";

export { assessConfidence, isTextDegraded, confidenceLabel, OCR_CONFIDENCE_FLOOR } from "./ocr";
export { decideVerdict, NO_CITATION_REASON, type MatchFacts, type Reachability } from "./verdicts";

/**
 * Adjudicate one item: citation -> resolved text -> quotation located (or not) -> a verdict.
 *
 * The precedence itself lives in `verdicts.ts` as a pure function; this file only gathers the
 * facts it consumes. That split is deliberate, because the precedence order is the product's
 * entire argument and it should be readable in one place without any I/O around it.
 */

export interface AuditItemOptions extends CascadeOptions {
  /** Directory holding fixtures/corpus. Injectable so tests can pin the true-home scan. */
  cachePaths?: CachePaths;
}

export async function auditItem(item: AuditItem, opts: AuditItemOptions = {}): Promise<AuditResult> {
  const outcome = await resolveCitation(item.citation, opts);

  // A quotation the parser could not bind to any citation. Handled before the cascade's own
  // refusal path so the reason names the real problem: this is a drafting defect, not a
  // fabricated citation, and reporting it as FABRICATED would be an accusation built on the
  // ABSENCE of a citation rather than on evidence about one.
  if (outcome.state === "refused" && outcome.why === "no-citation") {
    return {
      itemId: item.id,
      verdict: "UNVERIFIABLE_UNRESOLVED",
      reason: NO_CITATION_REASON,
      foundInDocument: item.quotation.span,
      resolutionTrace: outcome.trace,
    };
  }

  if (outcome.state !== "resolved") {
    const decision = decideVerdict(toReachability(outcome), null);
    return {
      itemId: item.id,
      verdict: decision.verdict,
      reason: decision.reason,
      resolutionTrace: outcome.trace,
    };
  }

  const cited = outcome.resolved;
  const match = findBestMatch(cited.text, item.quotation.raw);

  // The true-home scan runs ONLY when the quotation is absent from the cited case. Two reasons,
  // and the second is the important one: it wastes nothing on a quotation that is already
  // verified, and — critically — a hit in another case can never downgrade a VERIFIED.
  let trueHomeCase: ResolvedCase | null = null;
  let trueHomeSpan: MatchFacts["trueHome"] = null;

  if (!match && !cited.opinionBodyMissing) {
    const hit = findTrueHome(item.quotation.raw, {
      cachePaths: opts.cachePaths,
      // Excluding the cited case, by every citation it carries, is what keeps a correct citation
      // from being turned into an accusation by its own parallel reporters.
      exclude: [cited.citation, ...cited.allCitations],
    });
    if (hit) {
      trueHomeCase = hit.case;
      trueHomeSpan = { citation: hit.case.citation, caseName: hit.case.caseName, span: hit.span };
      outcome.trace.push({
        source: "cache",
        query: item.quotation.raw.slice(0, 60),
        outcome: "hit",
        detail: `found verbatim in ${hit.case.caseName} (${hit.case.citation}), not the cited case`,
      });
    } else {
      outcome.trace.push({
        source: "cache",
        query: item.quotation.raw.slice(0, 60),
        outcome: "miss",
        detail: "no other case in the local corpus contains this quotation verbatim",
      });
    }
  }

  const facts: MatchFacts = {
    foundInCited: match?.span ?? null,
    citedOpinionBodyMissing: cited.opinionBodyMissing,
    trueHome: trueHomeSpan,
    citedConfidence: cited.ocrConfidence,
  };

  const decision = decideVerdict({ kind: "reachable" }, facts);

  return {
    itemId: item.id,
    verdict: decision.verdict,
    reason: decision.reason,
    // The offset the reader is deep-linked to. For VERIFIED that is the cited case; for
    // MISATTRIBUTED it is the TRUE HOME, because that is the opinion the quotation was actually
    // found in and the one the report renders beside the cited case's text. An absent quotation
    // reports no offset at all — emitting a zero-length span would point at the start of the
    // opinion and read as if something had been found there.
    foundInOpinion: match?.span ?? trueHomeSpan?.span,
    // The document-side span is the item's own quotation span: the parser already measured it
    // against the user's original bytes.
    foundInDocument: item.quotation.span,
    citedCase: cited,
    // The scan's own ResolvedCase, carried through unchanged so the UI can render its text beside
    // the cited case's. Never reconstructed — a rebuilt case would lose the text the diff needs.
    trueHome: trueHomeCase ?? undefined,
    resolutionTrace: outcome.trace,
  };
}

/** Translate a cascade outcome into the reachability the precedence rule understands. */
function toReachability(outcome: CascadeOutcome): Reachability {
  switch (outcome.state) {
    case "resolved":
      return { kind: "reachable" };
    case "implausible":
      return { kind: "implausible", reason: outcome.reason };
    case "ambiguous":
      return { kind: "ambiguous", reason: outcome.reason, candidates: outcome.candidates };
    case "refused":
      // Three destinations, and the split is the honesty layer.
      //
      // `unresolved-in-coverage` with a SUBSTANTIVE index is the fabricated-citation case: the
      // volume exists, we read its index, and nothing in it claims this citation. With an empty or
      // near-empty index it is NOT — that is the shape a truncated or failed fetch leaves, and
      // accusing on it would mean accusing a real case whose volume we never actually read.
      if (outcome.why === "unresolved-in-coverage") {
        const size = outcome.indexSize ?? 0;
        if (size >= MIN_INDEX_FOR_ACCUSATION) {
          return { kind: "unresolved-substantive", reason: outcome.reason, indexSize: size };
        }
        return {
          kind: "refused",
          why: outcome.why,
          reason:
            `${outcome.reason}. Only ${size} record(s) were available to search, which is below the ` +
            `${MIN_INDEX_FOR_ACCUSATION} needed to treat an absent match as evidence — an index that ` +
            `small is far more likely a truncated fetch than a real citation`,
          isCoverage: false,
        };
      }
      // Only genuine coverage reasons become UNVERIFIABLE_COVERAGE. `no-citation` and `network` are
      // refusals of a different kind: one is a drafting defect, the other a transport failure.
      return {
        kind: "refused",
        why: outcome.why,
        reason: outcome.reason,
        isCoverage:
          outcome.why !== "no-citation" &&
          outcome.why !== "network" &&
          outcome.why !== "not-implemented",
      };
  }
}
