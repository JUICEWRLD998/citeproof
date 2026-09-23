import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedCase, Span } from "../types";
import { findQuoteIn } from "./match";
import { isCuratedFixtureRecord, parseCuratedFixture } from "../corpus/cap";
import { defaultCachePaths, type CachePaths } from "../corpus/cache";

/**
 * The misattribution resolver: given a sentence ABSENT from the cited case, find where it lives.
 *
 * ## Which way the errors point
 *
 * §6 of the plan calls this the differentiator and says a false "found it elsewhere" is worse
 * than no feature. That is the design constraint, and it is why this module:
 *
 *   - requires an EXACT normalised match, never a fuzzy one, before it will name a new home;
 *   - RANKS the exact candidates rather than naming the first, because a sentence has many homes:
 *     `.recon/probe-misattribution.mjs` measured **123 cases** containing Brown's holding, so
 *     "the first case containing it" names a quoter rather than the origin (see `rankTrueHomes`);
 *   - refuses to scan more than a bounded number of candidates, so a demo cannot spend minutes
 *     on a miss;
 *   - treats an unreadable or ambiguous source as no candidate rather than guessing.
 *
 * A fuzzy "true home" would mean telling a lawyer their quotation lives in a case it only roughly
 * resembles. That is a confident wrong answer, which is the worst thing this product can produce.
 *
 * ## The scan is local-first, and that is architectural
 *
 * §6: "local-cache scan first, then a single budgeted CL search." The local scan costs nothing and
 * cannot be rate-limited, and in this build the fixtures make it complete for the four verdicts
 * the demo shows. CourtListener is only reached when the local scan comes back empty, and the
 * verdict layer is written so that a CL miss changes nothing (Phase 3 measured that CL cannot
 * establish existence at all).
 */

export interface MisattributionHit {
  case: ResolvedCase;
  /** Where the sentence was found, in that case's ORIGINAL opinion text. */
  span: Span;
}

export interface MisattributionScanOptions {
  cachePaths?: CachePaths;
  /** Hard ceiling on candidate cases read. Bounds a demo, and bounds a pathological cache. */
  maxCandidates?: number;
  /** Skip the case the document already cited — a hit there would not be a misattribution. */
  exclude?: string[];
  /**
   * Additional candidates found elsewhere (phase 5: verified CourtListener results).
   *
   * They are merged into the SAME ranking rather than ranked separately, so one rule decides the
   * origin across every source. Two ranking rules would be two things to disagree, and the
   * disagreement would surface as an inconsistent "true home" for the same sentence depending on
   * which source happened to be switched on.
   */
  extraCandidates?: MisattributionHit[];
}

/**
 * Scan the curated corpus for a quotation, EXCLUDING the case the document cited.
 *
 * The exclusion is the whole point: if the sentence is in the cited case the verdict is VERIFIED,
 * not MISATTRIBUTED, and returning the cited case here would turn a correct citation into an
 * accusation.
 */
export function scanForTrueHome(
  quotation: string,
  opts: MisattributionScanOptions = {},
): MisattributionHit[] {
  const paths = opts.cachePaths ?? defaultCachePaths();
  const max = opts.maxCandidates ?? 200;
  const excluded = new Set((opts.exclude ?? []).map(normaliseCitation));
  const hits: MisattributionHit[] = [];

  let files: string[];
  try {
    files = readdirSync(paths.fixtures).filter((f) => f.endsWith(".json") && f !== "index.json");
  } catch {
    // An unreadable fixture directory is "no candidates", never an error that fails an audit.
    return [];
  }

  for (const file of files.slice(0, max)) {
    let record: unknown;
    try {
      record = JSON.parse(readFileSync(join(paths.fixtures, file), "utf8"));
    } catch {
      continue;
    }
    if (!isCuratedFixtureRecord(record)) continue;
    const resolved = parseCuratedFixture(record);
    // Excluded by ANY citation the case carries, not just its canonical one. A case reached
    // through a parallel reporter must be recognised as the same case: the ground truth cites
    // Brown as `347 U.S. 483` while Brown also answers to `74 S. Ct. 686` and `98 L. Ed. 2d 873`,
    // so matching on the canonical string alone would let the cited case back in through an alias
    // and produce a MISATTRIBUTED verdict naming the case the document had already cited.
    if (isExcluded(resolved, excluded)) continue;
    // A record with no usable text cannot host a sentence, and searching it would waste the
    // budget and could produce a nonsense hit against a caption.
    if (resolved.opinionBodyMissing) continue;

    // EXACT substring only — deliberately `findQuoteIn`, NOT `findBestMatch`.
    //
    // Semantic reason: the ranker would discard a fuzzy hit anyway (a near-match must never be
    // named as a home), so surfacing one here would just be a value nobody may use. The `exact`
    // flag that used to carry that information was always `true` by the time any caller read it,
    // which is exactly the kind of field that invites a future reader to trust it.
    //
    // Performance reason, measured: running the fuzzy window scan over four ~60KB opinions cost
    // **524ms per call** (`.recon/scratch-timing`), and it ran on every absent quotation — several
    // times per audited line. Dropping it leaves a handful of `indexOf` passes, which is a ~65x
    // improvement on the hottest path in an audit.
    const span = findQuoteIn(resolved.text, quotation);
    if (span) hits.push({ case: resolved, span });
  }

  return hits;
}

/**
 * The best true home, or null.
 *
 * Requires an EXACT match. A fuzzy candidate is deliberately NOT promoted to a true home: see the
 * module note. If nothing exact is found the answer is null, and the caller keeps FABRICATED.
 */
export function findTrueHome(
  quotation: string,
  opts: MisattributionScanOptions = {},
): MisattributionHit | null {
  return rankTrueHomes(quotation, opts).home;
}

export interface RankedTrueHomes {
  /** The candidate to NAME as the true home, or null when nothing matched exactly. */
  home: MisattributionHit | null;
  /** Every exact candidate, best-first. `home` is `ranked[0]` when present. */
  ranked: MisattributionHit[];
  /**
   * Exact candidates held back because they carry no decision date. Kept visible rather than
   * dropped: "we found it in an undated record" is information a reader may want, but it cannot
   * outrank a dated case, because "possibly ancient" must not displace a known origin.
   */
  undated: MisattributionHit[];
}

/**
 * Rank every case containing the quotation, best-first, and pick the origin.
 *
 * ## Why ranking is load-bearing rather than cosmetic
 *
 * `.recon/probe-misattribution.mjs` measured that CourtListener reports **123 cases** containing
 * Brown's holding. So in a real corpus a sentence has many homes, and the resolver's job is not
 * "find a case containing it" — that is trivial and wrong — but "find the case it ORIGINATED in".
 * Taking the first match names a case that merely quotes the line, which is a confident wrong
 * answer of exactly the kind this product exists to expose. Phase 3's own criterion for CL already
 * showed the failure: asked for Brown by name, CL ranks the cases that QUOTE Brown above Brown.
 *
 * ## The rule, and its honest limitation
 *
 * **Earliest decision date wins.** A sentence originates once and is then quoted by later cases, so
 * among cases containing it verbatim, the earliest-published is the origin. A dated candidate
 * always outranks an undated one, and ties break on the citation string so a report is byte-stable
 * across runs.
 *
 * THE LIMITATION: publication date is a PROXY for origin, not proof of it. The decisive evidence
 * would be the citation graph — a case listing the other's citation in its own `cites_to` is
 * demonstrably quoting it — and the curated fixtures do not carry `cites_to`. So this ranks
 * candidates and says which it believes is the origin; it does not claim to have proved the
 * direction of quotation. Recorded in docs/LIMITS.md.
 */
export function rankTrueHomes(
  quotation: string,
  opts: MisattributionScanOptions = {},
): RankedTrueHomes {
  const exact = scanForTrueHome(quotation, opts);

  // Merge in externally-verified candidates, de-duplicating by canonical citation so the same case
  // arriving from the local scan AND from the cross-check is one candidate, not two — otherwise a
  // case that both sources found would appear twice in the report's candidate list.
  const merged = [...exact];
  const seen = new Set(exact.map((h) => normaliseCitation(h.case.citation)));
  for (const extra of opts.extraCandidates ?? []) {
    const key = normaliseCitation(extra.case.citation);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(extra);
  }

  const dated = merged.filter((h) => !!h.case.decisionDate);
  const undated = merged.filter((h) => !h.case.decisionDate);

  dated.sort((a, b) => {
    // ISO yyyy-mm-dd compares correctly as a string, which is why the contract fixes that shape.
    if (a.case.decisionDate !== b.case.decisionDate) {
      return a.case.decisionDate < b.case.decisionDate ? -1 : 1;
    }
    return a.case.citation.localeCompare(b.case.citation);
  });
  undated.sort((a, b) => a.case.citation.localeCompare(b.case.citation));

  return { home: dated[0] ?? null, ranked: [...dated, ...undated], undated };
}

/** Does this case answer to any excluded citation, under any of its parallel reporters? */
function isExcluded(resolved: { citation: string; allCitations: string[] }, excluded: Set<string>): boolean {
  if (!excluded.size) return false;
  if (excluded.has(normaliseCitation(resolved.citation))) return true;
  return resolved.allCitations.some((c) => excluded.has(normaliseCitation(c)));
}

function normaliseCitation(c: string): string {
  return c.replace(/\s+/g, " ").trim().toUpperCase();
}
