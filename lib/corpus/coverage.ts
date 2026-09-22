import { readFileSync } from "node:fs";
import { join } from "node:path";

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

export type OutOfCoverageWhy =
  | "reporter-not-mapped"
  | "volume-beyond-corpus"
  | "page-beyond-volume"
  | "decision-date-beyond-corpus";

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
    return {
      reporter,
      why: "volume-beyond-corpus",
      boundary: `CAP holds ${reporter} volumes 1..${entry.maxVolume}; volume ${volume} does not exist (${ends})`,
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
