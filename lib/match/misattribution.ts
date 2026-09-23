import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedCase, Span } from "../types";
import { findBestMatch } from "../match/match";
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
  /** True when the match was exact after normalisation. Fuzzy hits are reported separately. */
  exact: boolean;
}

export interface MisattributionScanOptions {
  cachePaths?: CachePaths;
  /** Hard ceiling on candidate cases read. Bounds a demo, and bounds a pathological cache. */
  maxCandidates?: number;
  /** Skip the case the document already cited — a hit there would not be a misattribution. */
  exclude?: string[];
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
    if (excluded.has(normaliseCitation(resolved.citation))) continue;
    // A record with no usable text cannot host a sentence, and searching it would waste the
    // budget and could produce a nonsense hit against a caption.
    if (resolved.opinionBodyMissing) continue;

    const match = findBestMatch(resolved.text, quotation);
    if (match) hits.push({ case: resolved, span: match.span, exact: match.method === "exact" });
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
  const hits = scanForTrueHome(quotation, opts);
  const exact = hits.filter((h) => h.exact);
  if (!exact.length) return null;
  // Deterministic tie-break: first by citation string, so a report is stable across runs and two
  // runs of the same audit produce byte-identical evidence.
  return exact.sort((a, b) => a.case.citation.localeCompare(b.case.citation))[0];
}

function normaliseCitation(c: string): string {
  return c.replace(/\s+/g, " ").trim().toUpperCase();
}
