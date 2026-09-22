import type { ResolvedCase } from "../types";
import { CAP_BASE } from "./slugs";

/**
 * The Harvard CAP static-corpus HTTP client and payload parser.
 *
 * Two measured facts drive this file:
 *
 *  1. static.case.law is keyless and fast, but it is a third-party host shared by every
 *     consumer of the corpus. Requests are paced and failures retried with backoff rather
 *     than fired in parallel.
 *  2. A metadata 404 and a case 404 mean DIFFERENT things. Volume 999 of `us` does not
 *     exist at all; a missing case in a volume that does exist is a different finding.
 *     The caller needs both, so both are surfaced as distinguishable errors.
 */

export const CAP_HOST = new URL(CAP_BASE).host;

export interface CapHttpErrorShape {
  url: string;
  status: number;
  /** The corpus answered, and answered "no such thing". */
  notFound: boolean;
  retryAfterSeconds?: number;
  attempts: number;
}

export class CapHttpError extends Error {
  readonly detail: CapHttpErrorShape;
  constructor(detail: CapHttpErrorShape) {
    super(
      detail.notFound
        ? `CAP returned ${detail.status} for ${detail.url} (no such volume or case)`
        : `CAP request failed for ${detail.url}: HTTP ${detail.status} after ${detail.attempts} attempt(s)`,
    );
    this.name = "CapHttpError";
    this.detail = detail;
  }
}

export interface CapClientOptions {
  fetchImpl?: typeof fetch;
  /** Minimum spacing between ANY two requests this client makes. */
  minIntervalMs?: number;
  maxAttempts?: number;
  /** Injectable so tests can assert timing without sleeping. */
  sleepImpl?: (ms: number) => Promise<void>;
  userAgent?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class CapClient {
  private readonly fetchImpl: typeof fetch;
  private readonly minIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly userAgent: string;
  /** Serialises the pacing clock across concurrent callers. */
  private nextSlot = 0;
  /**
   * Requests actually issued, retries included. Phase 1's acceptance criterion is that a
   * cache hit costs ZERO calls, so the count has to be observable from outside to test it.
   */
  calls = 0;

  constructor(opts: CapClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.minIntervalMs = opts.minIntervalMs ?? 120;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.sleep = opts.sleepImpl ?? defaultSleep;
    this.userAgent = opts.userAgent ?? "citeproof/0.1 (lexhack; corpus layer)";
  }

  private async pace(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextSlot - now);
    this.nextSlot = Math.max(now, this.nextSlot) + this.minIntervalMs;
    if (wait > 0) await this.sleep(wait);
  }

  /**
   * GET a JSON document with pacing and bounded retries.
   *
   * A 404 is NOT retried — it is an answer, and retrying it burns a third-party budget to
   * learn nothing. 429 honours `retry-after`; 5xx and network faults back off exponentially.
   */
  async getJson(url: string): Promise<unknown> {
    let lastStatus = 0;
    let lastRetryAfter: number | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      await this.pace();
      let response: Response;
      try {
        this.calls++;
        response = await this.fetchImpl(url, { headers: { "User-Agent": this.userAgent } });
      } catch (err) {
        if (attempt === this.maxAttempts) {
          throw new CapHttpError({
            url,
            status: 0,
            notFound: false,
            attempts: attempt,
          });
        }
        await this.sleep(250 * 2 ** (attempt - 1));
        continue;
      }

      if (response.status === 200) {
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch {
          throw new CapHttpError({ url, status: 200, notFound: false, attempts: attempt });
        }
      }

      lastStatus = response.status;
      if (response.status === 404 || response.status === 410) {
        throw new CapHttpError({ url, status: response.status, notFound: true, attempts: attempt });
      }
      if (response.status === 429 || response.status >= 500) {
        const header = response.headers?.get?.("retry-after");
        const parsed = header ? Number(header) : NaN;
        lastRetryAfter = Number.isFinite(parsed) ? parsed : undefined;
        if (attempt === this.maxAttempts) break;
        await this.sleep(lastRetryAfter != null ? lastRetryAfter * 1000 : 500 * 2 ** (attempt - 1));
        continue;
      }
      throw new CapHttpError({ url, status: response.status, notFound: false, attempts: attempt });
    }

    throw new CapHttpError({
      url,
      status: lastStatus,
      notFound: false,
      retryAfterSeconds: lastRetryAfter,
      attempts: this.maxAttempts,
    });
  }

  /** `https://static.case.law/<reporter>/<volume>/CasesMetadata.json` — metadata only, no casebody. */
  async fetchVolumeMetadata(reporter: string, volume: number): Promise<CapMetadataEntry[]> {
    const url = `${CAP_BASE}/${reporter}/${volume}/CasesMetadata.json`;
    const json = await this.getJson(url);
    if (!Array.isArray(json)) {
      throw new CapHttpError({ url, status: 200, notFound: false, attempts: 1 });
    }
    return json as CapMetadataEntry[];
  }

  async fetchCaseJson(reporter: string, volume: number, caseFile: string): Promise<unknown> {
    return this.getJson(`${CAP_BASE}/${reporter}/${volume}/cases/${caseFile}.json`);
  }
}

// --- Payload shapes ---------------------------------------------------------
// Only the fields this layer actually reads are declared. The corpus carries far more; an
// undeclared field is not an error, and declaring the whole schema would rot.

export interface CapCitation {
  type?: string;
  cite: string;
}

export interface CapAnalysis {
  sha256?: string;
  ocr_confidence?: number;
  char_count?: number;
  word_count?: number;
  simhash?: string;
}

export interface CapMetadataEntry {
  id?: number;
  name?: string;
  name_abbreviation?: string;
  decision_date?: string;
  first_page?: string;
  last_page?: string;
  file_name?: string;
  citations?: CapCitation[];
  analysis?: CapAnalysis;
  court?: { name?: string; name_abbreviation?: string };
}

export interface CapCasePayload extends CapMetadataEntry {
  casebody?: {
    opinions?: Array<{ type?: string; text?: string }>;
    head_matter?: string;
  };
}

/**
 * ALL records claiming a citation. Plural, and deliberately so.
 *
 * Returning a single match was the first version of this function and it was wrong: an exact
 * cite is not unique. Measured in `us/572`, 803 of 893 distinct cites are shared, and the
 * sharers are DIFFERENT cases — the Supreme Court's orders lists print many short
 * dispositions starting on one page, so `572 U.S. 1082` matches 27 distinct cases, files
 * `1082-01` .. `1082-27`. A singular API invites `[0]`, and `[0]` here is a silent
 * misattribution of exactly the kind this product exists to catch.
 *
 * Matching is on `citations[].cite` ONLY. There is deliberately no name parameter: recon
 * proved CourtListener's top hit for a case NAME is a different, later case, and a name
 * fallback here would reintroduce that bug. Comparison is whitespace-insensitive.
 */
export function findCasesByCitation(
  metadata: CapMetadataEntry[],
  citation: string,
): CapMetadataEntry[] {
  const want = citation.replace(/\s+/g, " ").trim().toUpperCase();
  const matches: CapMetadataEntry[] = [];
  for (const entry of metadata) {
    for (const c of entry.citations ?? []) {
      if (c.cite.replace(/\s+/g, " ").trim().toUpperCase() === want) {
        matches.push(entry);
        break;
      }
    }
  }
  return matches;
}

/** Human-readable labels for an ambiguity report. Prefers the name, falls back to the file. */
export function describeMatches(matches: CapMetadataEntry[]): string[] {
  return matches.map((m) => {
    const label = m.name_abbreviation ?? m.name ?? "(unnamed)";
    const cite = m.citations?.[0]?.cite ?? "";
    return `${label}${cite ? ` ${cite}` : ""}${m.file_name ? ` [${m.file_name}]` : ""}`;
  });
}

/**
 * Assemble opinion text EXACTLY as `fixtures/corpus/*.json` was assembled.
 *
 * This is not a stylistic choice. fixtures/ground-truth.json records
 * `foundAtCharOffset: 9564` for Brown's holding, measured against this exact assembly. A
 * different join (a double newline, opinions reversed, head_matter omitted) shifts every
 * offset and quietly breaks the ground truth that the whole test suite rests on.
 */
export function assembleOpinionText(payload: CapCasePayload): string {
  const opinions = payload.casebody?.opinions ?? [];
  const body = opinions.map((o) => o.text ?? "").join("\n");
  return `${body}\n${payload.casebody?.head_matter ?? ""}`;
}

/**
 * Does this record carry text we can actually adjudicate against?
 *
 * Phase 1 answers the E6 question ("resolves but carries no casebody text") by inspection.
 * Whitespace-only text counts as none: a body of spaces cannot verify or refute a quotation,
 * and treating it as text would produce a confident FABRICATED from a parse artefact.
 */
export function hasUsableText(payload: CapCasePayload): boolean {
  const opinions = payload.casebody?.opinions ?? [];
  if (!opinions.length) return false;
  return opinions.some((o) => (o.text ?? "").trim().length > 0);
}

export interface ParseOptions {
  /** Used when the payload carries no `analysis.sha256` (some records omit it). */
  fallbackSha256?: string;
}

/**
 * Normalise a CAP case payload into the frozen ResolvedCase contract.
 *
 * `ocrConfidence` DEFAULTS TO 1 when the corpus does not report one. That direction matters:
 * a missing confidence value must not be read as "low confidence", or absent quotes in
 * un-analysed cases would all become UNVERIFIABLE and the tool would never accuse anyone.
 * A missing measurement is an absence of evidence about the TEXT QUALITY, not evidence of
 * bad text quality — and the one-directional OCR gate exists to suppress false accusations,
 * not to manufacture them.
 */
export function parseCasePayload(payload: CapCasePayload, opts: ParseOptions = {}): ResolvedCase {
  const citations = (payload.citations ?? []).map((c) => c.cite);
  const text = assembleOpinionText(payload);
  const sha256 = payload.analysis?.sha256 ?? opts.fallbackSha256 ?? "";
  const rawConfidence = payload.analysis?.ocr_confidence;
  return {
    citation: citations[0] ?? "",
    caseName: payload.name_abbreviation ?? payload.name ?? "",
    caseNameFull: payload.name ?? payload.name_abbreviation ?? "",
    decisionDate: payload.decision_date ?? "",
    court: payload.court?.name_abbreviation ?? payload.court?.name ?? "",
    allCitations: citations,
    sha256,
    ocrConfidence: typeof rawConfidence === "number" ? rawConfidence : 1,
    text,
    opinionBodyMissing: !hasUsableText(payload),
  };
}

// --- Curated fixture copies -------------------------------------------------
/**
 * fixtures/corpus/*.json is NOT a CAP payload. It is a pre-normalised record written by
 * `.recon/fetch-fixtures.mjs`: `text` is already the assembled string, and there is no
 * `casebody`, `citations` or `analysis` block.
 *
 * Two shapes therefore arrive at the corpus layer, and they must be told apart before
 * anything reads a field — `payload.casebody?.opinions` on a fixture record yields undefined,
 * which reads as "no text" and would silently turn every curated fixture into E6.
 */
export interface CuratedFixtureRecord {
  $provenance?: { source?: string; fetchedAt?: string; note?: string };
  citation: string;
  caseName: string;
  caseNameFull: string;
  decisionDate: string;
  court: string;
  allCitations: string[];
  sha256: string;
  ocrConfidence: number;
  charCount?: number;
  wordCount?: number;
  simhash?: string;
  opinionTypes?: string[];
  text: string;
}

export function isCuratedFixtureRecord(raw: unknown): raw is CuratedFixtureRecord {
  if (raw == null || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return typeof r.text === "string" && !("casebody" in r);
}

export function parseCuratedFixture(rec: CuratedFixtureRecord): ResolvedCase {
  return {
    citation: rec.citation ?? "",
    caseName: rec.caseName ?? "",
    caseNameFull: rec.caseNameFull ?? rec.caseName ?? "",
    decisionDate: rec.decisionDate ?? "",
    court: rec.court ?? "",
    allCitations: rec.allCitations ?? [],
    sha256: rec.sha256 ?? "",
    // Same one-directional default as parseCasePayload: a missing measurement is not evidence
    // of poor text quality.
    ocrConfidence: typeof rec.ocrConfidence === "number" ? rec.ocrConfidence : 1,
    text: rec.text ?? "",
    // A curated copy would not have been curated if it carried no text.
    opinionBodyMissing: !(rec.text ?? "").trim(),
  };
}
