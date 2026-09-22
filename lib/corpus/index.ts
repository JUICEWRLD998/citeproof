import type { ResolvedCase, CorpusError } from "../types";
import {
  CapClient,
  CapHttpError,
  assembleOpinionText,
  describeMatches,
  findCasesByCitation,
  hasUsableText,
  isCuratedFixtureRecord,
  parseCasePayload,
  parseCuratedFixture,
  type CapCasePayload,
  type CapClientOptions,
  type CapMetadataEntry,
} from "./cap";
import { CorpusCache, defaultCachePaths, type CachePaths, type FixtureIndexEntry } from "./cache";
import { citationReporterToSlug } from "./slugs";
import { detectOutOfCoverage, loadCoverageTable, type CoverageTable } from "./coverage";

/**
 * Thrown by every corpus function instead of returning null. Callers must branch on
 * `kind`: an unresolved citation and an out-of-coverage citation are DIFFERENT verdicts,
 * and collapsing them into one null is how a tool ends up accusing modern cases.
 */
export class CorpusFailure extends Error {
  readonly detail: CorpusError;
  constructor(detail: CorpusError) {
    super(detail.message);
    this.name = "CorpusFailure";
    this.detail = detail;
  }
}

export interface CorpusOptions extends CapClientOptions {
  cachePaths?: CachePaths;
}

interface Coordinates {
  reporter: string;
  volume: number;
  page: number;
  year?: number;
}

/**
 * Parse "347 U.S. 483" / "678 F. Supp. 3d 443" into coordinates.
 *
 * A full citation parser is Phase 2's job and is deliberately NOT duplicated here — this is
 * a minimal, strict reader for the one shape `getCaseByCitation` accepts. When it cannot be
 * certain, it returns null so the caller reports Unresolved rather than reaching for a
 * pattern-derived guess.
 */
export function parseCitationCoordinates(citation: string): Coordinates | null {
  const m = citation
    .replace(/\s+/g, " ")
    .trim()
    .match(/^(\d+)\s+(.+?)\s+(\d+)$/);
  if (!m) return null;
  const volume = Number(m[1]);
  const page = Number(m[3]);
  const reporter = citationReporterToSlug(m[2]);
  if (!Number.isFinite(volume) || !Number.isFinite(page) || !reporter) return null;
  return { reporter, volume, page };
}

/**
 * A single-year token is only accepted when it is unambiguous. A parenthetical span like
 * "(2018-2019)" is NOT read as a year: guessing wrong here would either invent a
 * post-coverage failure or hide one.
 */
export function parseCitationYear(citation: string): number | undefined {
  const paren = [...citation.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
  for (const inner of paren) {
    const span = inner.match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
    if (span) return Number(span[2]);
    const single = inner.match(/^(\d{4})$/);
    if (single) return Number(single[1]);
  }
  return undefined;
}

export class Corpus {
  private readonly client: CapClient;
  private readonly cache: CorpusCache;
  private readonly coverage: CoverageTable;

  constructor(opts: CorpusOptions = {}) {
    this.client = new CapClient(opts);
    this.cache = new CorpusCache(opts.cachePaths ?? defaultCachePaths());
    this.coverage = loadCoverageTable();
  }

  /**
   * Resolve a citation string (e.g. "347 U.S. 483") to a case with verbatim opinion text.
   *
   * Order of operations, and each step is deliberate:
   *   1. Coverage is checked BEFORE any I/O. A citation we already know we cannot reach must
   *      never cost a request, and must never fall through to FABRICATED.
   *   2. The curated fixture index is consulted second, so the test suite and a keyless demo
   *      resolve with zero network calls.
   *   3. Only then is the network touched, runtime cache first.
   *
   * Matching is on the EXACT `citations[].cite` string, never on case name — recon proved
   * name-matching silently returns the wrong case.
   */
  async getCaseByCitation(citation: string, opts: { year?: number } = {}): Promise<ResolvedCase> {
    const coords = parseCitationCoordinates(citation);
    if (!coords) {
      throw new CorpusFailure({
        kind: "Unresolved",
        message: `"${citation}" is not a citation this corpus layer can read (expected "<volume> <reporter> <page>")`,
      });
    }
    const year = opts.year ?? parseCitationYear(citation);
    return this.resolve(coords, year, citation);
  }

  /** Fetch a case by its known coordinates. Used by the fixture verifier and tests. */
  async getCaseAt(reporter: string, volume: number, caseFile: string): Promise<ResolvedCase> {
    const coverageFailure = this.coverageFailure({ reporter, volume, page: 1 });
    if (coverageFailure) throw coverageFailure;

    const fixture = this.cache.readFixture(reporter, volume, caseFile);
    if (fixture) return this.toResolvedCase(fixture.record, reporter, volume);

    const payload = await this.fetchCase(reporter, volume, caseFile);
    return this.toResolvedCase(payload, reporter, volume);
  }

  /**
   * Latest decision date we can serve for a reporter, or null if the reporter is unknown.
   * Drives UNVERIFIABLE_COVERAGE.
   */
  async coverageBoundary(reporter: string): Promise<string | null> {
    const slug = citationReporterToSlug(reporter) ?? reporter;
    return this.coverage.reporters[slug]?.latestDecisionDate ?? null;
  }

  /** The whole measured table. Exposed because the resolution trace renders it. */
  coverageTable(): CoverageTable {
    return this.coverage;
  }

  /** Total requests this instance has made. The demo shows it; tests assert on it. */
  networkCalls(): number {
    return this.client.calls;
  }

  // --- internals ------------------------------------------------------------

  /**
   * Null means "inside what we measured", NOT "this case exists". The two answers diverge
   * constantly (a fabricated citation is usually inside coverage) and only the cascade can
   * tell them apart.
   */
  private coverageFailure(coords: Coordinates): CorpusFailure | null {
    const out = detectOutOfCoverage(coords, this.coverage);
    if (!out) return null;
    return new CorpusFailure({
      kind: "OutOfCoverage",
      message: out.boundary,
      boundary: out.boundary,
    });
  }

  private async resolve(coords: Coordinates, year: number | undefined, citation: string): Promise<ResolvedCase> {
    // Lookups key on the citation AS WRITTEN, never on a rebuilt string. Rebuilding from
    // coordinates means choosing a reporter spelling, and choosing wrong ("163 US 537" for
    // "163 U.S. 537") silently fails to match a case that is sitting right there.
    const key = citation.replace(/\s+/g, " ").trim();

    // 1. Curated fixtures FIRST, before the coverage check.
    //
    // Ordering is load-bearing. A parallel citation reaches a case through a reporter whose
    // live coverage we may not have measured (`74 S. Ct. 686` cites Brown via `s-ct`), and
    // coverage is a statement about what we can FETCH — not about what we already hold. If we
    // have the text locally we can answer, so the coverage gate must not get first refusal.
    const fixture = this.findInFixtureIndex(key, coords);
    if (fixture) {
      const hit = this.cache.readFixture(fixture.reporter, fixture.volume, fixture.caseFile);
      if (hit) return this.toResolvedCase(hit.record, fixture.reporter, fixture.volume);
    }

    // 2. Coverage, before any I/O. A citation we know we cannot reach must never cost a
    // request, and must never fall through to FABRICATED.
    const coverageFailure = this.coverageFailure({ ...coords, year });
    if (coverageFailure) throw coverageFailure;

    // 3. Runtime volume index, then fetch and cache it.
    const metadata = await this.loadVolumeIndex(coords.reporter, coords.volume);
    const matches = findCasesByCitation(metadata, key);

    if (!matches.length) {
      throw new CorpusFailure({
        kind: "Unresolved",
        message: `"${key}" is inside CAP coverage but no case in ${coords.reporter} vol ${coords.volume} carries that citation`,
      });
    }

    // An ambiguous cite must NEVER fall through to the single-match path. Measured in us/572:
    // 803 of 893 cites are shared, and the sharers are different cases (orders lists). Taking
    // matches[0] would pick an arbitrary real case and adjudicate against its text.
    if (matches.length > 1) {
      const candidates = describeMatches(matches);
      throw new CorpusFailure({
        kind: "Ambiguous",
        message: `"${key}" matches ${matches.length} different cases in ${coords.reporter} vol ${coords.volume} — refusing to guess which one was cited`,
        candidates,
      });
    }

    const entry = matches[0];
    if (!entry.file_name) {
      throw new CorpusFailure({
        kind: "Unresolved",
        message: `"${key}" matched a record in ${coords.reporter} vol ${coords.volume} but that record names no case file`,
      });
    }

    // 3. Case text: sha-keyed runtime cache, else network.
    const payload = await this.fetchCaseByEntry(coords.reporter, coords.volume, entry);
    const resolved = this.toResolvedCase(payload, coords.reporter, coords.volume);
    return resolved;
  }

  private findInFixtureIndex(citation: string, coords: Coordinates): FixtureIndexEntry | null {
    const index = this.cache.readFixtureIndex();
    if (!index?.cases) return null;
    const want = citation.toUpperCase();
    for (const entry of index.cases) {
      const keys = [entry.citation, ...(entry.allCitations ?? [])];
      for (const key of keys) {
        if (key?.replace(/\s+/g, " ").trim().toUpperCase() === want) return entry;
      }
      // Volume + page is a second, coordinate-based key, so a parallel citation the curated
      // index did not record still resolves. The page must appear at the END of one of the
      // entry's citations, so two cases in one volume are never confused for each other.
      if (entry.reporter === coords.reporter && entry.volume === coords.volume) {
        if (keys.some((k) => new RegExp(`\\s${coords.page}\\s*$`).test(String(k).trim()))) return entry;
      }
    }
    return null;
  }

  private async loadVolumeIndex(reporter: string, volume: number): Promise<CapMetadataEntry[]> {
    const cached = this.cache.readVolumeIndex(reporter, volume);
    if (cached) return cached.record as CapMetadataEntry[];
    const metadata = await this.client.fetchVolumeMetadata(reporter, volume);
    this.cache.writeVolumeIndex(reporter, volume, metadata);
    return metadata;
  }

  private async fetchCaseByEntry(
    reporter: string,
    volume: number,
    entry: CapMetadataEntry,
  ): Promise<CapCasePayload> {
    const sha = entry.analysis?.sha256;
    if (sha) {
      const cached = this.cache.read(reporter, volume, sha);
      if (cached) return cached.record as CapCasePayload;
    }
    const payload = (await this.client.fetchCaseJson(reporter, volume, entry.file_name!)) as CapCasePayload;
    const payloadSha = payload.analysis?.sha256 ?? sha;
    if (payloadSha) this.cache.write(reporter, volume, payloadSha, payload);
    return payload;
  }

  private async fetchCase(reporter: string, volume: number, caseFile: string): Promise<CapCasePayload> {
    try {
      return (await this.client.fetchCaseJson(reporter, volume, caseFile)) as CapCasePayload;
    } catch (err) {
      throw this.toCorpusFailure(err);
    }
  }

  private toResolvedCase(raw: unknown, reporter: string, volume: number): ResolvedCase {
    void reporter;
    void volume;

    // Two shapes reach here: a curated fixture copy (already normalised) and a raw CAP
    // payload. Detail this up before any field access, or a fixture reads as "no text".
    if (isCuratedFixtureRecord(raw)) {
      const resolved = parseCuratedFixture(raw);
      if (!resolved.text.trim()) {
        throw new CorpusFailure({
          kind: "Unresolved",
          message: `${resolved.caseName || "case"} resolved but its curated copy carries no opinion text`,
        });
      }
      return resolved;
    }

    const payload = raw as CapCasePayload;

    // A resolved-but-empty record is E6, and it has its OWN error kind. Returning an empty
    // text here would let Phase 4 reach a confident FABRICATED from a parse artefact.
    if (!hasUsableText(payload)) {
      throw new CorpusFailure({
        kind: "Unresolved",
        message: `${payload.name_abbreviation ?? payload.name ?? "case"} resolved but carries no casebody text — the quotation can be neither confirmed nor denied`,
      });
    }

    const text = assembleOpinionText(payload);
    const fallback = payload.analysis?.sha256 ?? CorpusCache.hashText(text);
    return parseCasePayload(payload, { fallbackSha256: fallback });
  }

  private toCorpusFailure(err: unknown): CorpusFailure {
    if (err instanceof CapHttpError) {
      return new CorpusFailure({
        kind: "Network",
        message: err.message,
      });
    }
    if (err instanceof CorpusFailure) return err;
    return new CorpusFailure({
      kind: "Network",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// --- Module-level convenience -------------------------------------------------
// The frozen Phase 0 contract. Each call builds a short-lived Corpus; the caches it writes
// are on disk, so the next call starts warm. Phase 7's route handler keeps one instance.

export async function getCaseByCitation(
  citation: string,
  opts: { year?: number } & CorpusOptions = {},
): Promise<ResolvedCase> {
  return new Corpus(opts).getCaseByCitation(citation, { year: opts.year });
}

export async function getCaseAt(
  reporter: string,
  volume: number,
  caseFile: string,
  opts: CorpusOptions = {},
): Promise<ResolvedCase> {
  return new Corpus(opts).getCaseAt(reporter, volume, caseFile);
}

export async function coverageBoundary(reporter: string, opts: CorpusOptions = {}): Promise<string | null> {
  return new Corpus(opts).coverageBoundary(reporter);
}

export { CorpusCache, defaultCachePaths } from "./cache";
export { REPORTER_SLUGS, citationReporterToSlug } from "./slugs";
export { loadCoverageTable, detectOutOfCoverage } from "./coverage";
