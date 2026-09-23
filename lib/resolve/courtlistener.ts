/**
 * CourtListener v4 search — a CROSS-CHECK, and nothing more.
 *
 * ## Why this file is deliberately small
 *
 * The plan (§3.2 step 3) lists "cross-check via CourtListener search on the citation string"
 * as part of the cascade. Phase 3 probed whether that cross-check can actually carry weight,
 * and the answer is measured, not assumed:
 *
 * 1. **It is not an existence oracle.** `.recon/probe-crosscheck.mjs` searched
 *    `999 U.S. 1234, 1240` (an entirely fabricated citation) and CL returned 102 results,
 *    top hit *United States v. Bacon*, `900 F.3d 1234` — matched on the raw page token
 *    `1234`, not on the citation. Zero of the top five hits carried the queried citation in
 *    their own citation list, for the fabricated cite AND for the real one. A non-zero count
 *    is therefore evidence of NOTHING.
 * 2. **It cannot separate E3 from E4.** The corpus layer returns the same typed failure for
 *    both `999 U.S. 1234` (fabricated) and `678 F. Supp. 3d 443` (real, post-coverage). CL
 *    search does not separate them either — that separation is done by volume projection in
 *    `lib/corpus/coverage.ts`, which is the only thing here allowed to move a verdict.
 * 3. **Search is ANALYZED matching** (§4 row 2): 8 vs 10 quoted words return the identical
 *    1,068 results. Stop words are dropped, so a "miss" here cannot even mean "absent".
 *
 * So this client exists to ENRICH a resolved case (judge, docket number, court) and to
 * populate the demo's attempt log with a visible second source. Nothing it returns is ever
 * allowed to change a verdict, and it is never on the resolution hot path — the anonymous
 * budget is ~5 requests/minute, which is far too slow for one request per citation.
 *
 * **Query shape is enforced, not documented.** `searchByCitation` refuses any query that
 * does not read as a citation. There is deliberately no `searchByName`: recon proved CL's top
 * hit for "Brown v. Board of Education" is a 2015 N.D. Illinois district case, so a name
 * lookup here would silently reintroduce the exact misattribution this product sells against.
 */

export interface ClSearchHit {
  caseName: string | null;
  citations: string[];
  dateFiled: string | null;
  court: string | null;
  docketNumber: string | null;
  judge: string | null;
  clusterId: number | null;
  snippet: string;
}

export interface ClClientOptions {
  fetchImpl?: typeof fetch;
  /** Anonymous CL allows ~5 req/min (429 carries `retry-after`). Paced well under it. */
  minIntervalMs?: number;
  maxAttempts?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  userAgent?: string;
  /**
   * Hard ceiling on requests for the life of this client. The cross-check is enrichment, so
   * it must be unable to burn a third-party budget even if a caller loops over a long brief.
   */
  budget?: number;
}

export const CL_SEARCH_URL = "https://www.courtlistener.com/api/rest/v4/search/";

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ClBudgetExceeded extends Error {
  constructor(limit: number) {
    super(`CourtListener cross-check budget of ${limit} request(s) is exhausted`);
    this.name = "ClBudgetExceeded";
  }
}

/**
 * Thrown when the cross-check could not be COMPLETED — throttled, unreachable, server error, or
 * an unreadable body.
 *
 * This exists because "we could not ask" and "the second source found nothing" are different
 * facts, and collapsing them would make a rate limit look like evidence. A 429 on the anonymous
 * tier is the expected steady state, so this is a normal outcome rather than an exception: the
 * caller records it as `skipped` and proceeds on the corpus alone.
 *
 * A genuine empty result is `return []`, which only ever means the endpoint answered 200.
 */
export class ClUnavailable extends Error {
  constructor(reason: string, readonly status?: number) {
    super(reason);
    this.name = "ClUnavailable";
  }
}

/**
 * Does this string identify a case by CITATION rather than by name?
 *
 * Deliberately strict and deliberately here rather than in the caller: this is the one gate
 * that stops a name reaching a search endpoint that would answer it with a different case.
 */
export function looksLikeCitation(query: string): boolean {
  const q = query.replace(/\s+/g, " ").trim();
  // "<volume> <reporter> <page>", the only shape CL's citation matching is meaningful for.
  return /^\d{1,4}\s+[A-Za-z][A-Za-z.\s]*\d*(?:\s+\d{1,5})?/.test(q) && /\d/.test(q) && !/\bv\.?\s/i.test(q);
}

export class CourtListenerClient {
  private readonly fetchImpl: typeof fetch;
  private readonly minIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly userAgent: string;
  private readonly budget: number;
  private nextSlot = 0;
  /** Requests actually issued. Observable so tests can assert the cross-check is not on the hot path. */
  calls = 0;

  constructor(opts: ClClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.minIntervalMs = opts.minIntervalMs ?? 13_000;
    this.maxAttempts = opts.maxAttempts ?? 2;
    this.sleep = opts.sleepImpl ?? defaultSleep;
    this.userAgent = opts.userAgent ?? "citeproof/0.1 (lexhack; resolution cross-check)";
    this.budget = opts.budget ?? 10;
  }

  /**
   * Search opinions for a CITATION string. Returns [] for anything that is not a citation —
   * including a case name, which is refused rather than searched.
   *
   * Throws `ClUnavailable` when the request could not be COMPLETED (throttled, error, unreadable
   * body), and `ClBudgetExceeded` when this client's budget is spent. Empty array means only one
   * thing: the endpoint answered 200 and listed nothing.
   */
  async searchByCitation(citation: string): Promise<ClSearchHit[]> {
    if (!looksLikeCitation(citation)) return [];
    if (this.calls >= this.budget) throw new ClBudgetExceeded(this.budget);

    const url = `${CL_SEARCH_URL}?q=${encodeURIComponent(citation)}&type=o`;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      await this.pace();
      if (this.calls >= this.budget) throw new ClBudgetExceeded(this.budget);

      let response: Response;
      try {
        this.calls++;
        response = await this.fetchImpl(url, {
          headers: { "User-Agent": this.userAgent, Accept: "application/json" },
        });
      } catch (err) {
        if (attempt === this.maxAttempts) {
          throw new ClUnavailable(`request failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        await this.sleep(1000 * attempt);
        continue;
      }

      if (response.status === 200) {
        const text = await response.text();
        try {
          return normaliseHits(JSON.parse(text));
        } catch {
          // A 200 with an unparseable body is NOT "no results". Saying so would manufacture a
          // negative from a transport problem.
          throw new ClUnavailable("HTTP 200 but the body was not JSON", 200);
        }
      }

      // 429 is the expected steady state for anonymous callers. Honour retry-after once, then
      // give up rather than retrying into the limit — the cross-check is optional, so a failure
      // here must degrade to "no enrichment", never to a failed resolution.
      if (response.status === 429 || response.status >= 500) {
        const header = response.headers?.get?.("retry-after");
        const parsed = header ? Number(header) : NaN;
        if (attempt === this.maxAttempts) {
          throw new ClUnavailable(
            response.status === 429
              ? `throttled (HTTP 429${Number.isFinite(parsed) ? `, retry-after ${parsed}s` : ""})`
              : `server error (HTTP ${response.status})`,
            response.status,
          );
        }
        await this.sleep(Number.isFinite(parsed) ? parsed * 1000 : 2000 * attempt);
        continue;
      }

      throw new ClUnavailable(`unexpected HTTP ${response.status}`, response.status);
    }

    throw new ClUnavailable("exhausted attempts without a usable answer");
  }

  private async pace(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextSlot - now);
    this.nextSlot = Math.max(now, this.nextSlot) + this.minIntervalMs;
    if (wait > 0) await this.sleep(wait);
  }
}

/** Shape CL's v4 search payload into the fields the cascade records. Missing fields stay null. */
function normaliseHits(json: unknown): ClSearchHit[] {
  const results = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.map((raw) => {
    const r = raw as Record<string, unknown>;
    const citation = r.citation;
    const opinions = r.opinions;
    return {
      caseName: typeof r.caseName === "string" ? r.caseName : null,
      citations: Array.isArray(citation) ? citation.filter((c): c is string => typeof c === "string") : [],
      dateFiled: typeof r.dateFiled === "string" ? r.dateFiled : null,
      court: typeof r.court === "string" ? r.court : null,
      docketNumber: typeof r.docketNumber === "string" ? r.docketNumber : null,
      judge: typeof r.judge === "string" ? r.judge : null,
      clusterId: typeof r.cluster_id === "number" ? r.cluster_id : null,
      snippet:
        Array.isArray(opinions) && opinions[0] && typeof (opinions[0] as Record<string, unknown>).snippet === "string"
          ? String((opinions[0] as Record<string, unknown>).snippet).slice(0, 300)
          : "",
    };
  });
}

/**
 * Does any hit carry this citation in its OWN citation list?
 *
 * This is the only CL signal with any evidential weight, and the probe measured that even it
 * found nothing — 0 of 5 top hits for E3 and for E4. It is exposed so the attempt log can say
 * so explicitly, and so a later phase can use it as corroboration. It is NOT sufficient to
 * move a verdict, because "no hit carries the cite" is also what a real, unfashionable case
 * looks like.
 */
export function hitsCarryingCitation(hits: ClSearchHit[], citation: string): ClSearchHit[] {
  const want = citation.replace(/\s+/g, " ").trim().toUpperCase();
  return hits.filter((h) => h.citations.some((c) => c.replace(/\s+/g, " ").trim().toUpperCase() === want));
}
