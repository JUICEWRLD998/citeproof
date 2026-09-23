import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OutOfCoverageWhy } from "../types";

/**
 * The honesty layer.
 *
 * Every fact in the table this module reads was MEASURED from the live corpus
 * (`.recon/probe-slugs.mjs` -> `fixtures/coverage.json`). Nothing here is estimated, and
 * this module NEVER guesses: if a citation is outside what was measured, the answer is
 * "cannot verify", not "probably fine" and not "fabricated".
 *
 * A note on why an unknown reporter is treated as out-of-coverage rather than an error:
 * some of the 404 reporters CAP serves are ones this build deliberately does not carry. We
 * cannot tell "this reporter holds no such case" apart from "we did not map this reporter"
 * without a network round trip we would rather not spend on a hot path — and both answers
 * lead to the same user-visible verdict. Collapsing them here is safe; the `why` field keeps
 * the distinction available for the resolution trace.
 */

export interface ReporterCoverage {
  volumes: number;
  maxVolume: number;
  latestDecisionDate: string;
  /** Largest page number seen in the reporter's LAST volume. The structural sanity check. */
  maxPageObserved: number | null;
}

export interface CoverageTable {
  measuredAt: string | null;
  reportersEnumerated: number;
  reporters: Record<string, ReporterCoverage>;
}

export const COVERAGE_FIXTURE = "fixtures/coverage.json";

export function loadCoverageTable(root = process.cwd()): CoverageTable {
  const path = join(root, COVERAGE_FIXTURE);
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    $provenance?: { measuredAt?: string | null; reportersEnumerated?: number };
    reporters: Record<string, ReporterCoverage>;
  };
  return {
    measuredAt: raw.$provenance?.measuredAt ?? null,
    reportersEnumerated: raw.$provenance?.reportersEnumerated ?? Object.keys(raw.reporters).length,
    reporters: raw.reporters,
  };
}

/**
 * Re-exported for existing importers. The union itself now lives in `lib/types.ts`, because the
 * verdict layer branches on it and the contract should own the vocabulary rather than depend on
 * this implementation file.
 */
export type { OutOfCoverageWhy };

export interface OutOfCoverage {
  reporter: string;
  why: OutOfCoverageWhy;
  /** Human-readable, one line. Goes into CorpusError.boundary and the resolution trace. */
  boundary: string;
  latestDecisionDate: string | null;
}

export interface CitationCoordinates {
  reporter: string;
  volume: number;
  page: number;
  /** Phase 2 supplies this. Absent means the date rule is skipped, not assumed to pass. */
  year?: number;
}

function yearOf(iso: string | null): number | null {
  const y = iso?.slice(0, 4);
  return y && /^\d{4}$/.test(y) ? Number(y) : null;
}

/**
 * Decide whether a citation falls outside what the corpus can serve.
 *
 * Returns null when the citation is inside coverage — including when it is inside coverage
 * and simply does not exist, which is a DIFFERENT answer (`Unresolved`, and later
 * FABRICATED). Conflating the two is the single worst bug this product could ship.
 *
 * The checks run cheapest-and-most-certain first, and the page check exists because of a
 * measured negative result: `999 U.S. 1234` and `678 F. Supp. 3d 443` are BOTH 404 on
 * metadata, and `.recon/probe-slugs.mjs` failed to find any page-based discriminator between
 * them (us reaches page 2722, so 1234 is not structurally absurd). So this module does NOT
 * claim to separate the fabricated citation from the post-coverage real one. It reports what
 * it can prove: volume beyond the corpus, page beyond the volume, or date beyond the corpus.
 * The E3/E4 distinction is Phase 3's to make with the resolution cascade, not this file's.
 */
export function detectOutOfCoverage(
  citation: CitationCoordinates,
  table: CoverageTable,
  /**
   * The measured rate table the volume projection reads. Injectable so a caller (and a test)
   * can supply an empty table and prove the REFUSE branch — a projection built on a guessed
   * rate would be a fabricated accusation wearing a number.
   */
  rates: VolumeRates = loadVolumeRates(),
): OutOfCoverage | null {
  const { reporter, volume, page } = citation;
  const entry = table.reporters[reporter];

  if (!entry) {
    return {
      reporter,
      why: "reporter-not-mapped",
      boundary: `reporter "${reporter}" is not in the CAP coverage table (${table.reportersEnumerated} reporters measured)`,
      latestDecisionDate: null,
    };
  }

  // Both facts are reported for these two, not just the structural one: "this volume does not
  // exist" and "coverage for this reporter ends 2019-08-19" are independently true and
  // independently useful, and the date is what a lawyer needs to understand WHY we cannot
  // reach a 2023 case.
  const ends = `coverage for ${reporter} ends ${entry.latestDecisionDate}`;

  if (volume < 1 || volume > entry.maxVolume) {
    // Phase 3: a volume past the corpus is the ONE out-of-coverage case that can be more than
    // a refusal. If the citation asserts a year and volume growth projects the cited volume to
    // have been unreachable by then, that is a positive structural claim — recorded with its
    // measured ratio and bound, so downstream can see the number rather than trust the label.
    const projection = assessVolumePlausibility(citation, rates);
    if (projection?.implausible) {
      return {
        reporter,
        why: "volume-implausible-for-year",
        boundary:
          `${reporter} projected ${projection.projectedVolume} volumes by ${projection.atYear} ` +
          `(measured ${projection.volumesPerYear}/yr from ${projection.from}); volume ${volume} is ` +
          `${projection.ratio}x that, past the recorded bound of ${volumeProjectionBound()}`,
        latestDecisionDate: entry.latestDecisionDate,
      };
    }
    // Otherwise: REFUSE. Inside the projection band the volume is structurally plausible, and a
    // real-but-uningested case is indistinguishable from an invented one. That is E4, and
    // refusing is the only honest answer.
    const projectedNote =
      projection == null
        ? ""
        : ` A volume-${volume} citation at ${projection.atYear} is only ${projection.ratio}x the projection, inside the bound — so this is refused, not accused.`;
    return {
      reporter,
      why: "volume-beyond-corpus",
      boundary: `CAP holds ${reporter} volumes 1..${entry.maxVolume}; volume ${volume} does not exist (${ends}).${projectedNote}`,
      latestDecisionDate: entry.latestDecisionDate,
    };
  }

  if (entry.maxPageObserved != null && page > entry.maxPageObserved) {
    return {
      reporter,
      why: "page-beyond-volume",
      boundary: `largest ${reporter} page observed is ${entry.maxPageObserved}; page ${page} exceeds it (${ends})`,
      latestDecisionDate: entry.latestDecisionDate,
    };
  }

  if (citation.year != null && entry.latestDecisionDate) {
    const boundaryYear = yearOf(entry.latestDecisionDate);
    if (boundaryYear != null && citation.year > boundaryYear) {
      return {
        reporter,
        why: "decision-date-beyond-corpus",
        boundary: `${reporter} coverage ends ${entry.latestDecisionDate}; a ${citation.year} decision is past it`,
        latestDecisionDate: entry.latestDecisionDate,
      };
    }
  }

  return null;
}

// --- Volume plausibility projection (Phase 3) --------------------------------
/**
 * The mechanism that finally separates E3 from E4, after `probe-slugs.mjs` failed to.
 *
 * THE PROBLEM. `999 U.S. 1234` (fabricated) and `678 F. Supp. 3d 443` (real, post-coverage)
 * both sit past their reporter's boundary and both 404. §4 row 12 records that no PAGE- or
 * VOLUME-SHAPE check separates them, and `.recon/probe-crosscheck.mjs` measured that
 * CourtListener search does not either. Yet the ground truth requires FABRICATED for one and
 * UNVERIFIABLE_COVERAGE for the other — a tool that cannot tell them apart must accuse a real
 * case, which is the failure this product exists to prevent.
 *
 * THE MECHANISM. A reporter's volume count grows at a measurable rate. For every mapped
 * reporter, `.recon/probe-volume-rates.mjs` measures `volumesPerYear` from its first volume's
 * decision date to its last, and `fixtures/volume-rates.json` stores the result. Projecting
 * from the boundary to the citation's OWN ASSERTED YEAR gives the volume that reporter had
 * plausibly reached by then. If the cited volume materially overshoots that projection, the
 * citation could not have existed at the date it claims.
 *
 * MEASURED (2026-09-23, `.recon/probe-volume-rates.mjs`):
 *   E3  999 U.S. 1234, (2021)     ratio 1.697  -> implausible
 *   E4  678 F. Supp. 3d 443, 2023 ratio 1.064  -> plausible (refuse)
 *   real controls at 2021-2023    1.007 / 1.151 / 1.098 -> all plausible
 *
 * THE BOUND IS 1.5, and its placement is a deliberate asymmetry rather than a midpoint. The
 * geometric midpoint of the measured gap is 1.398; the bound sits above it so that a real
 * citation landing between 1.15 and 1.5 is REFUSED rather than accused. Refusing to adjudicate
 * a fabricated citation is a safe miss; accusing a real one is the worst outcome available.
 *
 * WHAT THIS IS NOT. It is not a statistical model. It is one fabricated anchor against three
 * real controls, on nine reporters, using a linear rate — a rate that has demonstrably
 * accelerated (f-supp-3d runs at 72.9 vol/yr against us at 2.5). It is a documented,
 * re-derivable heuristic with its own falsification test, and the honest reading of a pass is
 * "could not refute", not "proved real". Recalibrate on a larger sample before trusting it in
 * production; see docs/LIMITS.md.
 */
export interface VolumeProjection {
  /** Volumes per year, measured from this reporter's first volume to its last. */
  volumesPerYear: number;
  /** ISO date of the last volume measured. Projection starts here. */
  from: string;
  /** The citation's asserted year, which the projection is evaluated at. */
  atYear: number;
  /** Projected volume count at `atYear`, rounded to one decimal. */
  projectedVolume: number;
  /** asserted volume / projected volume. > 1 means the cite runs AHEAD of the reporter. */
  ratio: number;
  /** True when `ratio` exceeds PROJECTION_BOUND. */
  implausible: boolean;
}

interface VolumeRateEntry {
  maxVolume: number;
  latestDecisionDate: string;
  volumesPerYear: number | null;
}

interface VolumeRateTable {
  $provenance?: { measuredAt?: string | null };
  reporters: Record<string, VolumeRateEntry>;
  projection?: { bound?: number };
}

export const VOLUME_RATES_FIXTURE = "fixtures/volume-rates.json";

/**
 * The recorded bound. Read from the fixture when present, so re-running the probe re-calibrates
 * the code rather than requiring two edits in two files to stay in agreement.
 */
export function volumeProjectionBound(root = process.cwd()): number {
  return loadVolumeRates(root).bound;
}

export interface VolumeRates {
  measuredAt: string | null;
  bound: number;
  reporters: Record<string, VolumeRateEntry>;
}

const ABSENT_RATES: VolumeRates = { measuredAt: null, bound: 1.5, reporters: {} };

/**
 * Load the measured rate table. A missing or malformed fixture returns an EMPTY table rather
 * than throwing, and an empty table makes every projection refuse — which degrades to the
 * Phase 1 behaviour (refuse for everything) instead of accusing on absent evidence.
 */
export function loadVolumeRates(root = process.cwd()): VolumeRates {
  try {
    const raw = JSON.parse(
      readFileSync(join(root, VOLUME_RATES_FIXTURE), "utf8"),
    ) as VolumeRateTable;
    if (!raw?.reporters || typeof raw.reporters !== "object") return ABSENT_RATES;
    return {
      measuredAt: raw.$provenance?.measuredAt ?? null,
      bound: typeof raw.projection?.bound === "number" ? raw.projection.bound : ABSENT_RATES.bound,
      reporters: raw.reporters,
    };
  } catch {
    return ABSENT_RATES;
  }
}

function decimalYear(iso: string | null): number | null {
  if (!iso) return null;
  const [y, m = "1", d = "1"] = iso.split("-");
  const year = Number(y);
  if (!Number.isFinite(year)) return null;
  return year + (Number(m) - 1) / 12 + (Number(d) - 1) / 365;
}

/**
 * Project a reporter's volume count to a year, and judge the cited volume against it.
 *
 * Returns NULL — never a judgement — whenever a number is missing: an unmapped reporter, an
 * unmeasured rate, or no asserted year. Null means "cannot project", and the caller must treat
 * that exactly as it treats an inside-coverage citation: refuse to adjudicate. A projection
 * built on a guessed rate would be a fabricated accusation wearing a number.
 */
export function assessVolumePlausibility(
  citation: CitationCoordinates,
  rates: VolumeRates = loadVolumeRates(),
): VolumeProjection | null {
  const entry = rates.reporters[citation.reporter];
  if (!entry || entry.volumesPerYear == null || citation.year == null) return null;

  const from = decimalYear(entry.latestDecisionDate);
  if (from == null) return null;

  const ahead = citation.year - from;
  // A citation dated BEFORE the boundary is not projected. Its absence is a question about
  // whether the case exists, not about whether the volume could — and the date rule in
  // detectOutOfCoverage has already had its say.
  if (ahead <= 0) return null;

  const projectedVolume = entry.maxVolume + entry.volumesPerYear * ahead;
  if (!(projectedVolume > 0)) return null;

  const ratio = citation.volume / projectedVolume;
  return {
    volumesPerYear: entry.volumesPerYear,
    from: entry.latestDecisionDate,
    atYear: citation.year,
    projectedVolume: Number(projectedVolume.toFixed(1)),
    ratio: Number(ratio.toFixed(3)),
    implausible: ratio > rates.bound,
  };
}
