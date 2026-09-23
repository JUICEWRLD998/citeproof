import type { Citation, CorpusError, ResolutionStep, ResolvedCase } from "../types";
import { Corpus, CorpusFailure } from "../corpus";
import { CourtListenerClient, hitsCarryingCitation, type ClSearchHit } from "./courtlistener";

/**
 * The resolution cascade: citation string -> resolved case + verbatim text, NEVER by case name.
 *
 * ## The rule this file exists to enforce
 *
 * §3.2 and the phase-3 watch item both say it: recon measured that CourtListener's top hit for
 * the case NAME "Brown v. Board of Education" is a 2015 N.D. Illinois district case. Any code
 * path that resolves by name silently misattributes — which is the exact bug CiteProof sells
 * against, committed by CiteProof. So there is no name parameter anywhere in this cascade, and
 * `citations.test.ts` asserts that a name-only query cannot resolve.
 *
 * ## Outcome is a closed union, not a ResolvedCase-or-null
 *
 * Collapsing these to null is how a tool ends up accusing real cases, because four very
 * different situations all look like "nothing found":
 *
 *   { state: "resolved" }           the case and its text are in hand
 *   { state: "refused" }            we cannot reach it — UNVERIFIABLE, never an accusation
 *   { state: "implausible" }        the citation could not have existed as dated — FABRICATED
 *   { state: "ambiguous" }          several real cases share this cite — REFUSE, never accuse
 *
 * Only `implausible` may lead to FABRICATED, and it is reachable only through the measured
 * volume projection in lib/corpus/coverage.ts.
 */

export type CascadeOutcome =
  | {
      state: "resolved";
      citation: Citation;
      resolved: ResolvedCase;
      trace: ResolutionStep[];
      enrichment?: ClSearchHit;
    }
  | {
      state: "refused";
      citation: Citation;
      reason: string;
      why: string;
      trace: ResolutionStep[];
    }
  | {
      state: "implausible";
      citation: Citation;
      reason: string;
      projection: { ratio: number; bound: number; projectedVolume: number; atYear: number };
      trace: ResolutionStep[];
    }
  | {
      state: "ambiguous";
      citation: Citation;
      reason: string;
      candidates: string[];
      trace: ResolutionStep[];
    };

export interface CascadeOptions {
  /** Reading of the corpus. Injected in tests so no test touches the network. */
  corpus?: Corpus;
  /** The cross-check client. Injected so tests can prove it is never on the hot path. */
  crossCheck?: CourtListenerClient | null;
  /**
   * Run the CourtListener cross-check. OFF by default: it costs ~1 request per citation
   * against a 5/min anonymous budget, and `.recon/probe-crosscheck.mjs` measured that it adds
   * no evidential weight. The demo turns it on to show the attempt log; batch runs do not.
   */
  crossCheckEnabled?: boolean;
}

/** The citation coordinates the corpus layer reads. Kept narrow on purpose — see parseCitationCoordinates. */
function toCitationString(citation: Citation): string | null {
  if (!citation.reporter || !citation.volume) return null;
  // Page 0 is how the Phase 2 parser records "<vol> <reporter> at <n>" — a pincite, not a
  // starting page. A carry-forward normally fills the real page in; when it did not, there is
  // no page to look up and the citation cannot be resolved from this string.
  if (!citation.page) return null;
  return `${citation.volume} ${citation.reporter} ${citation.page}`;
}

/**
 * Map a typed corpus failure onto a cascade outcome.
 *
 * This function is the whole reason `CorpusError` carries a machine-readable `why`: every
 * branch below except `volume-implausible-for-year` is a REFUSAL. The distinction is the
 * product's honesty layer, so it is made by branching on the type, never by pattern-matching
 * the human-readable boundary string.
 */
function fromFailure(citation: Citation, detail: CorpusError, trace: ResolutionStep[]): CascadeOutcome {
  switch (detail.kind) {
    case "OutOfCoverage":
      if (detail.why === "volume-implausible-for-year" && detail.projection) {
        return {
          state: "implausible",
          citation,
          reason:
            `the citation asserts a ${citation.year} decision, but ${citation.reporter} was projected ` +
            `to hold ${detail.projection.projectedVolume} volumes by then; volume ${citation.volume} is ` +
            `${detail.projection.ratio}x that projection (bound ${detail.projection.bound})`,
          projection: detail.projection,
          trace,
        };
      }
      // Every other out-of-coverage reason is a REFUSAL. This is E4: the case is real, we simply
      // cannot reach it, and calling it fabricated would accuse the case in our own origin story.
      return {
        state: "refused",
        citation,
        reason: detail.boundary,
        why: detail.why,
        trace,
      };

    case "Ambiguous":
      // Measured in us/572: 803 of 893 cites are shared by different cases (orders lists).
      // Taking the first match adjudicates against an arbitrary real case's text.
      return {
        state: "ambiguous",
        citation,
        reason: detail.message,
        candidates: detail.candidates,
        trace,
      };

    case "Unresolved":
      // Inside coverage, and no case carries the citation. NOT an accusation by itself: the
      // verdict layer still consults opinionBodyMissing and the OCR floor before it accuses.
      return { state: "refused", citation, reason: detail.message, why: "unresolved-in-coverage", trace };

    case "Network":
      // A network fault is never evidence about the law. Refuse.
      return { state: "refused", citation, reason: detail.message, why: "network", trace };

    case "NotImplemented":
      return { state: "refused", citation, reason: detail.message, why: "not-implemented", trace };
  }
}

/**
 * Resolve one parsed citation.
 *
 * Order of operations, each step deliberate:
 *   1. Coverage and the volume projection run INSIDE the corpus layer, before any I/O. A cite we
 *      cannot reach must never cost a request against a third-party budget.
 *   2. The curated fixture index resolves offline, so the whole suite runs with no network.
 *   3. The cross-check runs LAST, only after a case is in hand, and never changes the outcome.
 */
export async function resolveCitation(
  citation: Citation,
  opts: CascadeOptions = {},
): Promise<CascadeOutcome> {
  const corpus = opts.corpus ?? new Corpus();
  const trace: ResolutionStep[] = [];

  const key = toCitationString(citation);
  if (!key) {
    // An unattributed quotation (the Phase 2 stand-in has volume 0) or a short form whose
    // carrier was never seen. Refused, not accused — there is nothing to look up.
    trace.push({
      source: "cap-metadata",
      query: citation.raw || "(unattributed)",
      outcome: "skipped",
      detail: "no volume/reporter/page to look up — an unattributed quotation or an unbound short form",
    });
    return {
      state: "refused",
      citation,
      reason:
        "the quotation carries no resolvable citation, so there is nothing to check it against",
      why: "no-citation",
      trace,
    };
  }

  let resolved: ResolvedCase;
  try {
    resolved = await corpus.getCaseByCitation(key, { year: citation.year });
    trace.push({
      source: "cap-metadata",
      query: key,
      outcome: "hit",
      detail: `${resolved.caseName} (${resolved.decisionDate || "date unknown"})`,
    });
    if (resolved.ocrConfidence < 0.5) {
      trace.push({
        source: "cap-case",
        query: key,
        outcome: "hit",
        detail: `verbatim text ${resolved.text.length} chars, OCR confidence ${resolved.ocrConfidence} — below the accusation floor`,
      });
    } else {
      trace.push({
        source: "cap-case",
        query: key,
        outcome: "hit",
        detail: `verbatim text ${resolved.text.length} chars, OCR confidence ${resolved.ocrConfidence}`,
      });
    }
  } catch (err) {
    const detail =
      err instanceof CorpusFailure
        ? err.detail
        : ({ kind: "Network", message: err instanceof Error ? err.message : String(err) } as CorpusError);
    trace.push({
      source: "cap-metadata",
      query: key,
      outcome: detail.kind === "Network" ? "error" : "miss",
      detail: `${detail.kind}: ${detail.message}`,
    });
    const outcome = fromFailure(citation, detail, trace);
    // The cross-check runs even on a miss, but ONLY to record what the second source said. It
    // cannot change `outcome`, and the probe measured that it adds no evidential weight.
    if (opts.crossCheckEnabled && opts.crossCheck) {
      await crossCheck(citation, key, trace, opts.crossCheck);
    }
    return outcome;
  }

  let enrichment: ClSearchHit | undefined;
  if (opts.crossCheckEnabled && opts.crossCheck) {
    enrichment = await crossCheck(citation, key, trace, opts.crossCheck);
  }

  return { state: "resolved", citation, resolved, trace, enrichment };
}

/**
 * Record what CourtListener says, without ever letting it move the outcome.
 *
 * Its return value is passed through to the caller for the demo's attempt log and nothing else.
 * A budget or throttle failure is recorded as a `skipped` step, not an error: the cross-check is
 * enrichment, so "we did not ask" must never read as "the second source disagreed".
 */
async function crossCheck(
  citation: Citation,
  key: string,
  trace: ResolutionStep[],
  client: CourtListenerClient,
): Promise<ClSearchHit | undefined> {
  let hits: ClSearchHit[];
  try {
    hits = await client.searchByCitation(key);
  } catch (err) {
    trace.push({
      source: "courtlistener-search",
      query: key,
      outcome: "skipped",
      detail: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }

  if (!hits.length) {
    trace.push({
      source: "courtlistener-search",
      query: key,
      outcome: "miss",
      detail: "no results — NOTE: this is NOT evidence the case does not exist; search is analyzed, not verbatim",
    });
    return undefined;
  }

  const carrying = hitsCarryingCitation(hits, key);
  trace.push({
    source: "courtlistener-search",
    query: key,
    outcome: "hit",
    detail:
      carrying.length > 0
        ? `${hits.length} results, ${carrying.length} carrying this citation itself (${carrying[0].caseName})`
        : `${hits.length} results, but NONE carries this citation in its own citation list — treated as no corroboration`,
  });
  return carrying[0] ?? hits[0];
}

/**
 * Resolve every citation in a document, deduplicating the lookup by citation string.
 *
 * Dedup keeps the corpus budget proportional to DISTINCT citations rather than to occurrences —
 * a brief that cites `347 U.S. 483` nine times should cost one resolution, not nine.
 */
export async function resolveCitations(
  citations: Citation[],
  opts: CascadeOptions = {},
): Promise<CascadeOutcome[]> {
  const byKey = new Map<string, Promise<CascadeOutcome>>();
  const out: CascadeOutcome[] = [];

  for (const citation of citations) {
    const key = toCitationString(citation) ?? `unattributed:${citation.span.start}`;
    let pending = byKey.get(key);
    if (!pending) {
      pending = resolveCitation(citation, opts);
      byKey.set(key, pending);
    }
    const settled = await pending;
    // The cached outcome carries the FIRST citation object; re-point it at this one so the
    // caller can map every occurrence back to its own span.
    out.push({ ...settled, citation } as CascadeOutcome);
  }

  return out;
}

/** True when this outcome means "we could not adjudicate", i.e. every non-accusatory miss. */
export function isRefusal(outcome: CascadeOutcome): boolean {
  return outcome.state === "refused" || outcome.state === "ambiguous";
}

export type { ClSearchHit };
export { CourtListenerClient, looksLikeCitation, hitsCarryingCitation, ClUnavailable } from "./courtlistener";
