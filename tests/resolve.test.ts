import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Citation } from "../lib/types";
import { Corpus } from "../lib/corpus";
import {
  assessVolumePlausibility,
  loadVolumeRates,
  volumeProjectionBound,
} from "../lib/corpus/coverage";
import { parseCitations } from "../lib/resolve/parse";
import {
  CourtListenerClient,
  hitsCarryingCitation,
  isRefusal,
  looksLikeCitation,
  resolveCitation,
  resolveCitations,
  type CascadeOutcome,
} from "../lib/resolve";

/**
 * Phase 3 acceptance, from implementation.md:
 *   - "347 U.S. 483" resolves to the 1954 SCOTUS case
 *   - a case-name-only query is REJECTED BY DESIGN (a regression test asserting we never
 *     resolve by name — recon proved CL's top hit for the name is a 2015 district case)
 *   - an unresolvable citation produces a populated attempt log that serialises to JSON
 *   - the log serialises to JSON
 *
 * No test here touches the network. `npm test` must pass offline.
 */

const root = process.cwd();

/** A citation object shaped the way the Phase 2 parser produces one. */
function citation(overrides: Partial<Citation> & { raw: string }): Citation {
  return {
    volume: 0,
    reporter: "",
    page: 0,
    span: { start: 0, end: 0 },
    shortForm: false,
    ...overrides,
  };
}

/**
 * A Corpus that THROWS if the network is touched. Every out-of-coverage assertion below uses
 * it, because "coverage is decided before any I/O" is a claim worth proving rather than
 * believing — and because a test that reaches the network is a test that fails on a plane.
 */
function offlineCorpus(): Corpus {
  return new Corpus({
    fetchImpl: (async () => {
      throw new Error("coverage/existence must be decided without touching the network");
    }) as unknown as typeof fetch,
  });
}

describe("resolve: the fixture citation resolves to the 1954 case, with its text", () => {
  it("resolves 347 U.S. 483 from the curated index with ZERO network calls", async () => {
    const corpus = new Corpus();
    const parsed = parseCitations("In Brown v. Board of Education, 347 U.S. 483, 495 (1954), the Court held");
    expect(parsed).toHaveLength(1);

    const outcome = await resolveCitation(parsed[0], { corpus });
    expect(outcome.state).toBe("resolved");
    if (outcome.state !== "resolved") throw new Error("unreachable");

    expect(outcome.resolved.caseName).toContain("Brown");
    expect(outcome.resolved.decisionDate).toBe("1954-05-17");
    expect(outcome.resolved.text.length).toBeGreaterThan(20_000);
    // The frozen offset the whole suite rests on.
    expect(outcome.resolved.text.indexOf("Separate educational facilities are inherently unequal.")).toBe(9564);
    expect(corpus.networkCalls()).toBe(0);
  });

  it("carries a populated attempt log that serialises to JSON", async () => {
    const corpus = new Corpus();
    const parsed = parseCitations("347 U.S. 483, 495 (1954)");
    const outcome = await resolveCitation(parsed[0], { corpus });
    expect(outcome.state).toBe("resolved");

    expect(outcome.trace.length).toBeGreaterThan(0);
    for (const step of outcome.trace) {
      expect(["cap-metadata", "cap-case", "courtlistener-search", "cache"]).toContain(step.source);
      expect(["hit", "miss", "error", "skipped"]).toContain(step.outcome);
      expect(step.query.length).toBeGreaterThan(0);
    }
    // The demo renders this, so it must survive a round trip.
    const round = JSON.parse(JSON.stringify(outcome.trace));
    expect(round).toEqual(outcome.trace);
  });
});

describe("resolve: we NEVER resolve by case name (the regression this product exists for)", () => {
  /**
   * §3.2 and the phase-3 watch item: recon measured that CourtListener's top hit for
   * "Brown v. Board of Education" is a 2015 N.D. Illinois district case. Any code path that
   * resolves by name silently misattributes — CiteProof committing the exact bug it sells
   * against. These assertions exist so that can never happen quietly.
   */
  it("refuses a name-only citation rather than looking anything up", async () => {
    const corpus = offlineCorpus();
    const outcome = await resolveCitation(
      citation({ raw: "Brown v. Board of Education" }),
      { corpus },
    );
    expect(outcome.state).toBe("refused");
    if (outcome.state !== "refused") throw new Error("unreachable");
    expect(outcome.why).toBe("no-citation");
    expect(corpus.networkCalls()).toBe(0);
  });

  it("refuses a name written in the Volume Reporer Page shape", async () => {
    // "163 U.S. 537" is Plessy and resolves; the NAME is not a citation and must not.
    const corpus = offlineCorpus();
    const outcome = await resolveCitation(
      citation({ raw: "Plessy v. Ferguson", volume: 163, reporter: "U.S.", page: 537 }),
      { corpus },
    );
    // Note: volume/reporter/page are present here, so this DOES resolve — the guard is that
    // the name string never reaches a lookup, which the trace proves by querying the citation.
    expect(outcome.trace[0].query).toBe("163 U.S. 537");
    expect(outcome.trace[0].query).not.toContain("Plessy");
  });

  it("has no name parameter anywhere on the cross-check client", async () => {
    // The API surface itself is the guard: there is no searchByName to call.
    expect(typeof (CourtListenerClient.prototype as unknown as Record<string, unknown>).searchByName).toBe(
      "undefined",
    );
    expect(typeof CourtListenerClient.prototype.searchByCitation).toBe("function");
  });

  it("refuses to send a name to CourtListener even if a caller tries", async () => {
    const asked: string[] = [];
    const client = new CourtListenerClient({
      fetchImpl: (async (url: string) => {
        asked.push(String(url));
        return { status: 200, text: async () => JSON.stringify({ results: [] }) } as unknown as Response;
      }) as unknown as typeof fetch,
      minIntervalMs: 0,
      sleepImpl: async () => {},
    });
    const hits = await client.searchByCitation("Brown v. Board of Education");
    expect(hits).toEqual([]);
    // Nothing was asked. This is the whole point: the refusal happens before the request.
    expect(asked).toEqual([]);
    expect(client.calls).toBe(0);
  });

  it("classifies citation-shaped queries and name-shaped ones correctly", () => {
    expect(looksLikeCitation("347 U.S. 483")).toBe(true);
    expect(looksLikeCitation("678 F. Supp. 3d 443")).toBe(true);
    expect(looksLikeCitation("999 U.S. 1234, 1240")).toBe(true);
    expect(looksLikeCitation("Brown v. Board of Education")).toBe(false);
    expect(looksLikeCitation("Anderson v. Liberty Lobby, Inc.")).toBe(false);
  });
});

describe("resolve: E3 is IMPLAUSIBLE (may accuse); E4 is REFUSED (must never accuse)", () => {
  /**
   * THE central Phase 3 finding. The corpus layer returns the SAME typed failure for both
   * citations — `678 F. Supp. 3d 443` is real and post-coverage, `999 U.S. 1234` is invented —
   * and `.recon/probe-slugs.mjs` proved no page/volume SHAPE separates them, while
   * `.recon/probe-crosscheck.mjs` proved CourtListener search does not either.
   *
   * What separates them is a measured volume-growth projection: `us` ran 2.54 vol/yr, so by
   * E3's asserted year 2021 it had plausibly reached ~589 volumes, making volume 999 1.697x the
   * projection. E4's `678 F. Supp. 3d` at 2023 is only 1.064x f-supp-3d's projection.
   *
   * If this pair of assertions ever inverts, the tool accuses a real case — the single worst
   * outcome available to it.
   */
  it("marks the invented 999 U.S. 1234 (2021) implausible, with the measured numbers", async () => {
    const corpus = offlineCorpus();
    const parsed = parseCitations(
      "See Anderson v. Liberty Lobby, Inc., 999 U.S. 1234, 1240 (2021) (holding that “x”).",
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].year).toBe(2021);

    const outcome = await resolveCitation(parsed[0], { corpus });
    expect(outcome.state).toBe("implausible");
    if (outcome.state !== "implausible") throw new Error("unreachable");

    expect(outcome.projection.ratio).toBeGreaterThan(outcome.projection.bound);
    expect(outcome.projection.bound).toBe(volumeProjectionBound());
    // Ratio and projection are recorded numbers, not prose — the receipt Phase 4 renders.
    expect(outcome.projection.ratio).toBeCloseTo(1.697, 2);
    expect(outcome.projection.atYear).toBe(2021);
    expect(outcome.reason).toContain("2021");
    expect(JSON.parse(JSON.stringify(outcome.trace))).toEqual(outcome.trace);
    // Decided with no I/O at all.
    expect(corpus.networkCalls()).toBe(0);
  });

  it("REFUSES the real 2023 case the corpus cannot reach — and never calls it implausible", async () => {
    const corpus = offlineCorpus();
    const parsed = parseCitations(
      "Nor can Plaintiff rely on Mata v. Avianca, Inc., 678 F. Supp. 3d 443, 452 (S.D.N.Y. 2023).",
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].year).toBe(2023);

    const outcome = await resolveCitation(parsed[0], { corpus });
    expect(outcome.state).toBe("refused");
    if (outcome.state !== "refused") throw new Error("unreachable");

    expect(outcome.why).toBe("volume-beyond-corpus");
    expect(outcome.reason).toContain("2019-08-19");
    // The refusal states the projection it checked, so a reader can see WHY it is not accusing.
    expect(outcome.reason).toContain("inside the bound");
    expect(isRefusal(outcome)).toBe(true);
    expect(corpus.networkCalls()).toBe(0);
  });

  it("refuses EVERY real-looking citation at the boundary, never accusing one", async () => {
    // The safety property, stated as a sweep rather than a single case. Each of these is real
    // and unreachable; every one must be a refusal.
    const corpus = offlineCorpus();
    for (const [raw, year] of [
      ["593 U.S. 1", 2021],
      ["650 F. Supp. 3d 1", 2022],
      ["700 F. Supp. 3d 1", 2023],
    ] as const) {
      const parsed = parseCitations(`${raw} (${year})`);
      const outcome = await resolveCitation(parsed[0], { corpus });
      expect(outcome.state, `${raw} must be refused, never accused`).toBe("refused");
    }
  });

  it("REFUSES when the reporter has no measured rate — no projection, no accusation", async () => {
    // A projection built on a guessed rate would be a fabricated accusation wearing a number.
    // An unmeasured reporter must yield null from the projection and a refusal downstream.
    const rates = { measuredAt: null, bound: 1.5, reporters: {} };
    const projection = assessVolumePlausibility(
      { reporter: "us", volume: 999, page: 1234, year: 2021 },
      rates,
    );
    expect(projection).toBeNull();

    const corpus = new Corpus({
      volumeRates: rates,
      fetchImpl: (async () => {
        throw new Error("no I/O for a citation with no measured projection");
      }) as unknown as typeof fetch,
    });
    const parsed = parseCitations("999 U.S. 1234 (2021)");
    const outcome = await resolveCitation(parsed[0], { corpus });
    expect(outcome.state).toBe("refused");
    if (outcome.state !== "refused") throw new Error("unreachable");
    expect(outcome.why).toBe("volume-beyond-corpus");
  });

  it("does not project a citation dated BEFORE the boundary", () => {
    // Inside the corpus's era, so the volume/date projection has nothing to say; the date rule
    // and the ordinary lookup handle it. Projecting backwards would be meaningless.
    expect(
      assessVolumePlausibility({ reporter: "us", volume: 900, page: 1, year: 1950 }, loadVolumeRates()),
    ).toBeNull();
    expect(
      assessVolumePlausibility({ reporter: "us", volume: 900, page: 1 }, loadVolumeRates()),
    ).toBeNull();
  });
});

describe("resolve: the CourtListener cross-check is enrichment and CANNOT move a verdict", () => {
  /**
   * `.recon/probe-crosscheck.mjs` measured that CL search is not an existence oracle: searching
   * the fabricated `999 U.S. 1234, 1240` returned 102 results whose top hit was
   * *United States v. Bacon*, `900 F.3d 1234` — matched on the raw page token `1234`. Zero of
   * the top five hits carried the queried citation in their own citation list, for the
   * fabricated cite AND for the real one.
   *
   * These tests pin that: a cross-check that "finds" things must not change the outcome.
   */
  function clientAnswering(hits: unknown[], counter = { n: 0 }): CourtListenerClient {
    return new CourtListenerClient({
      fetchImpl: (async () => {
        counter.n++;
        return { status: 200, text: async () => JSON.stringify({ results: hits }) } as unknown as Response;
      }) as unknown as typeof fetch,
      minIntervalMs: 0,
      sleepImpl: async () => {},
    });
  }

  it("still refuses E4 when the cross-check returns 9,351 results claiming to know it", async () => {
    // The exact shape the probe found for E4: a huge count that proves nothing.
    const hits = Array.from({ length: 5 }, (_, i) => ({
      caseName: `Decoy ${i}`,
      citation: ["341 F. Supp. 3d 856"],
      dateFiled: "2018-09-20",
    }));
    const counter = { n: 0 };
    const crossCheck = clientAnswering(hits, counter);
    const parsed = parseCitations("678 F. Supp. 3d 443, 452 (S.D.N.Y. 2023)");

    const outcome = await resolveCitation(parsed[0], {
      corpus: offlineCorpus(),
      crossCheck,
      crossCheckEnabled: true,
    });
    expect(outcome.state).toBe("refused");
    expect(counter.n).toBe(1);
    // And the log says explicitly that the count is not corroboration.
    const step = outcome.trace.find((s) => s.source === "courtlistener-search");
    expect(step?.outcome).toBe("hit");
    expect(step?.detail).toContain("NONE carries this citation");
  });

  it("still marks E3 implausible when the cross-check returns results", async () => {
    const hits = [{ caseName: "United States v. Bacon", citation: ["900 F.3d 1234"], dateFiled: "2018-08-21" }];
    const parsed = parseCitations("999 U.S. 1234, 1240 (2021)");
    const outcome = await resolveCitation(parsed[0], {
      corpus: offlineCorpus(),
      crossCheck: clientAnswering(hits),
      crossCheckEnabled: true,
    });
    expect(outcome.state).toBe("implausible");
  });

  it("is OFF by default — zero cross-check requests unless explicitly enabled", async () => {
    const counter = { n: 0 };
    const crossCheck = clientAnswering([{ caseName: "x", citation: [] }], counter);
    const parsed = parseCitations("347 U.S. 483, 495 (1954)");
    await resolveCitation(parsed[0], { corpus: new Corpus(), crossCheck });
    expect(counter.n).toBe(0);
    expect(crossCheck.calls).toBe(0);
  });

  it("records a budget/throttle failure as `skipped`, never as a disagreement", async () => {
    // "We did not ask" must never read as "the second source said no".
    const client = new CourtListenerClient({
      fetchImpl: (async () => ({ status: 429, headers: { get: () => "44" }, text: async () => "" }) as unknown as Response) as unknown as typeof fetch,
      minIntervalMs: 0,
      sleepImpl: async () => {},
      maxAttempts: 1,
    });
    const parsed = parseCitations("347 U.S. 483, 495 (1954)");
    const outcome = await resolveCitation(parsed[0], {
      corpus: new Corpus(),
      crossCheck: client,
      crossCheckEnabled: true,
    });
    expect(outcome.state).toBe("resolved");
    const step = outcome.trace.find((s) => s.source === "courtlistener-search");
    expect(step?.outcome).toBe("skipped");
  });

  it("enriches a resolved case with the hit whose OWN citation list matches", async () => {
    const hits = [
      { caseName: "Decoy", citation: ["999 X.Y. 1"], dateFiled: "1999-01-01" },
      { caseName: "Brown v. Board of Education", citation: ["347 U.S. 483"], dateFiled: "1954-05-17", judge: "Warren" },
    ];
    const parsed = parseCitations("347 U.S. 483, 495 (1954)");
    const outcome = await resolveCitation(parsed[0], {
      corpus: new Corpus(),
      crossCheck: clientAnswering(hits),
      crossCheckEnabled: true,
    });
    expect(outcome.state).toBe("resolved");
    if (outcome.state !== "resolved") throw new Error("unreachable");
    // The carrying hit wins over the first result, because only it is corroboration.
    expect(outcome.enrichment?.caseName).toBe("Brown v. Board of Education");
    expect(outcome.enrichment?.judge).toBe("Warren");
  });

  it("filters hits down to those carrying the citation", () => {
    const hits = [
      { caseName: "A", citations: ["900 F.3d 1234"], dateFiled: null, court: null, docketNumber: null, judge: null, clusterId: null, snippet: "" },
      { caseName: "B", citations: ["999 U.S. 1234"], dateFiled: null, court: null, docketNumber: null, judge: null, clusterId: null, snippet: "" },
    ];
    expect(hitsCarryingCitation(hits, "999 U.S. 1234").map((h) => h.caseName)).toEqual(["B"]);
    // Whitespace-insensitive, like the corpus matcher.
    expect(hitsCarryingCitation(hits, "999  U.S.  1234")).toHaveLength(1);
    expect(hitsCarryingCitation(hits, "347 U.S. 483")).toHaveLength(0);
  });
});

describe("resolve: an ambiguous cite is REFUSED, never guessed at", () => {
  /**
   * Measured in us/572: 803 of 893 distinct cites are claimed by more than one record, and the
   * sharers are DIFFERENT cases (SCOTUS orders lists). Taking the first match would adjudicate
   * a quotation against an arbitrary real case — the precise silent misattribution CiteProof
   * exists to expose. And it must NOT become "unresolved", because the precedence rule turns
   * unresolved-but-in-coverage into FABRICATED: an accusation.
   */
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "citeproof-resolve-amb-"));
    const idx = join(dir, "index");
    mkdirSync(idx, { recursive: true });
    writeFileSync(
      join(idx, "us-572-index.json"),
      JSON.stringify([
        {
          name_abbreviation: "Biton v. Lippert",
          file_name: "1110-01",
          decision_date: "2014-05-05",
          citations: [{ type: "official", cite: "572 U.S. 1110" }],
          analysis: { sha256: "a".repeat(64) },
        },
        {
          name_abbreviation: "McWilliams v. Schumacher",
          file_name: "1110-02",
          decision_date: "2014-05-05",
          citations: [{ type: "official", cite: "572 U.S. 1110" }],
          analysis: { sha256: "b".repeat(64) },
        },
      ]),
    );
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an ambiguous outcome listing the candidates, and never resolves", async () => {
    const corpus = new Corpus({
      fetchImpl: (async () => {
        throw new Error("an ambiguous cite must be decided without fetching a case body");
      }) as unknown as typeof fetch,
      cachePaths: {
        fixtures: join(dir, "no-fixtures"),
        runtime: join(dir, "corpus"),
        runtimeIndex: join(dir, "index"),
      },
      minIntervalMs: 0,
      sleepImpl: async () => {},
    });

    const parsed = parseCitations("572 U.S. 1110, 1115 (2014)");
    // 2014 is at the `us` boundary, so the year rule does not push it out of coverage.
    const outcome = await resolveCitation(parsed[0], { corpus });
    expect(outcome.state).toBe("ambiguous");
    if (outcome.state !== "ambiguous") throw new Error("unreachable");
    expect(outcome.candidates).toHaveLength(2);
    expect(outcome.reason).toContain("refusing to guess");
    expect(isRefusal(outcome)).toBe(true);
  });
});

describe("resolve: an unattributed quotation is refused, not accused", () => {
  it("refuses a bare quotation with no citation near it", async () => {
    // The Phase 2 stand-in citation: volume 0, empty reporter. It exists so neither a real case
    // nor a fabricated one is invented for a quotation the parser could not bind.
    const corpus = offlineCorpus();
    const outcome = await resolveCitation(citation({ raw: "" }), { corpus });
    expect(outcome.state).toBe("refused");
    if (outcome.state !== "refused") throw new Error("unreachable");
    expect(outcome.why).toBe("no-citation");
    expect(corpus.networkCalls()).toBe(0);
  });
});

describe("resolve: batch resolution deduplicates by citation", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "citeproof-resolve-dedup-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("costs one resolution for a citation repeated three times", async () => {
    const counter = { n: 0 };
    const metadata = [
      {
        name_abbreviation: "Example v. Sample",
        decision_date: "1954-05-17",
        file_name: "0001-01",
        citations: [{ cite: "163 U.S. 537" }],
        analysis: { sha256: "d".repeat(64), ocr_confidence: 0.9 },
      },
    ];
    const payload = { ...metadata[0], casebody: { opinions: [{ type: "majority", text: "x".repeat(100) }] } };
    const corpus = new Corpus({
      fetchImpl: (async (url: string) => {
        counter.n++;
        const body = String(url).endsWith("CasesMetadata.json") ? metadata : payload;
        return { status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
      }) as unknown as typeof fetch,
      cachePaths: {
        fixtures: join(dir, "no-fixtures"),
        runtime: join(dir, "corpus"),
        runtimeIndex: join(dir, "index"),
      },
      minIntervalMs: 0,
      sleepImpl: async () => {},
    });

    const parsed = parseCitations(
      "163 U.S. 537, 540 (1896) ... Id. at 545 ... see also 163 U.S. 537, 550 (1896)",
    );
    expect(parsed.length).toBeGreaterThanOrEqual(3);

    const outcomes = await resolveCitations(parsed, { corpus });
    expect(outcomes).toHaveLength(parsed.length);
    // One volume index + one case body, however many times the citation appears.
    expect(counter.n).toBe(2);
  });

  it("re-points each outcome at its own citation span, so the UI can deep-link every occurrence", async () => {
    const corpus = new Corpus();
    const document = "In Brown v. Board of Education, 347 U.S. 483, 495 (1954) ... and again at 347 U.S. 483, 496 (1954).";
    const parsed = parseCitations(document);
    const outcomes = await resolveCitations(parsed, { corpus });
    expect(outcomes.length).toBe(parsed.length);
    const starts = outcomes.map((o) => o.citation.span.start);
    expect(new Set(starts).size).toBe(starts.length);
  });
});

describe("resolve: the volume-rate table is measured data, not a guess", () => {
  const rates = loadVolumeRates();

  it("carries a measured rate and date for every reporter it lists", () => {
    const entries = Object.entries(rates.reporters);
    expect(entries.length).toBeGreaterThan(0);
    for (const [slug, r] of entries) {
      // A null rate is legitimate (unmeasured) and makes the projection refuse. A PRESENT rate
      // must come with the date it was measured from, or the projection cannot be evaluated.
      if (r.volumesPerYear != null) {
        expect(r.volumesPerYear, slug).toBeGreaterThan(0);
        expect(r.latestDecisionDate, slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("records the bound alongside the evidence that derived it", () => {
    const raw = JSON.parse(readFileSync(join(root, "fixtures/volume-rates.json"), "utf8"));
    expect(raw.projection.bound).toBe(volumeProjectionBound());
    // The derivation must travel with the number, or the next reader cannot recalibrate it.
    expect(raw.projection.boundDerivation.length).toBeGreaterThan(50);
    expect(raw.projection.e3Ratio).toBeGreaterThan(raw.projection.bound);
    expect(raw.projection.maxRealControlRatio).toBeLessThan(raw.projection.bound);
    expect(raw.$provenance.measuredBy).toContain("probe-volume-rates");
  });

  it("bounds the projection so the measured real controls are never accused", () => {
    // The falsification test for the bound itself. If a future recalibration lets a real
    // citation through, this fails before the tool can accuse anyone.
    const bound = volumeProjectionBound();
    for (const [slug, volume, year] of [
      ["us", 593, 2021],
      ["f-supp-3d", 650, 2022],
      ["f-supp-3d", 700, 2023],
    ] as const) {
      const p = assessVolumePlausibility({ reporter: slug, volume, page: 1, year }, rates);
      expect(p, `${slug} ${volume} (${year}) must project`).not.toBeNull();
      expect(p!.implausible, `${slug} ${volume} (${year}) ratio ${p!.ratio} must be inside bound ${bound}`).toBe(false);
    }
  });
});

describe("resolve: the real fixture brief resolves end to end, offline", () => {
  /**
   * The integration assertion. Everything above tests a unit; this runs the actual Phase 2
   * parser over the actual frozen brief and resolves every citation it finds through the actual
   * cascade, against the curated fixtures, with the network unreachable.
   *
   * It is the test that would catch a cascade that is individually correct and collectively
   * wrong — the failure mode where each piece passes and the pipeline still mis-handles the
   * four lines the product's entire pitch rests on.
   */
  const brief = readFileSync(join(root, "fixtures/briefs/motion-to-dismiss.txt"), "utf8");

  it("classifies all four ground-truth lines the way the ground truth requires", async () => {
    const corpus = offlineCorpus();
    const parsed = parseCitations(brief);
    const outcomes = await resolveCitations(parsed, { corpus });

    /** The cascade outcome reached by the citation whose raw text contains `needle`. */
    const stateFor = (needle: string) => {
      const hit = outcomes.filter((o) => o.citation.raw.replace(/\s+/g, " ").includes(needle));
      return hit.length ? hit[hit.length - 1].state : "NOT PARSED";
    };

    // E1 — a true holding, correctly cited. Must resolve, with its text.
    expect(stateFor("347 U.S. 483"), "E1 must resolve").toBe("resolved");
    // E2 and E5 — Plessy. Real and in the corpus, so it resolves; the misattribution is the
    // MATCHER's finding (Phase 4/5), not a resolution failure.
    expect(stateFor("163 U.S. 537"), "Plessy must resolve").toBe("resolved");
    // E3 — the invented citation. Implausible for its asserted year, which is what licenses
    // Phase 4 to reach FABRICATED.
    expect(stateFor("999 U.S. 1234"), "E3 must be implausible").toBe("implausible");
    // E4 — real, famous, post-coverage. MUST be refused. If this ever reads "implausible", the
    // tool is accusing the case its own origin story is about.
    expect(stateFor("678 F. Supp. 3d 443"), "E4 must be REFUSED").toBe("refused");

    for (const outcome of outcomes) {
      expect(JSON.parse(JSON.stringify(outcome.trace))).toEqual(outcome.trace);
    }
    expect(corpus.networkCalls()).toBe(0);
  });

  it("never accuses a real case when the corpus is unreachable", async () => {
    // Every citation unresolvable and every I/O throwing: each outcome must be a REFUSAL, with
    // one deliberate exception worth stating.
    //
    // E3 (`999 U.S. 1234`) still comes back `implausible` under a total outage, and that is
    // correct rather than a leak: the implausibility decision is derived from the coverage
    // table and the measured volume rates, both local fixtures, and needs no network at all.
    // The accusation rests on measured data, not on a live request that could fail.
    const corpus = new Corpus({
      fetchImpl: (async () => {
        throw new Error("simulated network outage");
      }) as unknown as typeof fetch,
      cachePaths: {
        fixtures: join(root, "fixtures", "nonexistent"),
        runtime: join(root, ".cache", "nonexistent-test"),
        runtimeIndex: join(root, ".cache", "nonexistent-test-index"),
      },
      minIntervalMs: 0,
      sleepImpl: async () => {},
    });
    const outcomes = await resolveCitations(parseCitations(brief), { corpus });

    const byRaw = (needle: string) => outcomes.filter((o) => o.citation.raw.includes(needle));
    for (const needle of ["347 U.S. 483", "163 U.S. 537", "678 F. Supp. 3d 443"]) {
      const hits = byRaw(needle);
      expect(hits.length, `${needle} should have parsed`).toBeGreaterThan(0);
      for (const outcome of hits) {
        expect(
          outcome.state,
          `a real citation (${needle}) was judged ${outcome.state} during an outage — it must refuse`,
        ).toBe("refused");
      }
    }
  });
});

describe("resolve: an in-coverage citation no case carries is refused, not accused", () => {
  it("refuses with a populated trace when the volume exists but no case carries the cite", async () => {
    // The distinction that matters: this is NOT out of coverage (volume 163 exists, page is in
    // range). It is `unresolved-in-coverage`, and whether it becomes FABRICATED is Phase 4's
    // call — after it has consulted opinionBodyMissing and the OCR floor.
    const dir = mkdtempSync(join(tmpdir(), "citeproof-resolve-miss-"));
    try {
      const idx = join(dir, "index");
      mkdirSync(idx, { recursive: true });
      writeFileSync(join(idx, "us-163-index.json"), JSON.stringify([]));

      const corpus = new Corpus({
        fetchImpl: (async () => {
          throw new Error("the empty volume index is already on disk");
        }) as unknown as typeof fetch,
        cachePaths: {
          fixtures: join(dir, "no-fixtures"),
          runtime: join(dir, "corpus"),
          runtimeIndex: join(idx),
        },
        minIntervalMs: 0,
        sleepImpl: async () => {},
      });

      const parsed = parseCitations("163 U.S. 999 (1896)");
      const outcome = await resolveCitation(parsed[0], { corpus });
      expect(outcome.state).toBe("refused");
      if (outcome.state !== "refused") throw new Error("unreachable");
      expect(outcome.why).toBe("unresolved-in-coverage");
      expect(outcome.trace.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
