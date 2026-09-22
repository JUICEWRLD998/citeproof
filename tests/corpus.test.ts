import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CorpusError } from "../lib/types";
import { Corpus, CorpusFailure, parseCitationCoordinates } from "../lib/corpus";
import {
  assembleOpinionText,
  findCasesByCitation,
  hasUsableText,
  isCuratedFixtureRecord,
  parseCasePayload,
  parseCuratedFixture,
  type CapCasePayload,
  type CapMetadataEntry,
} from "../lib/corpus/cap";
import { citationReporterToSlug, isKnownSlug } from "../lib/corpus/slugs";
import { detectOutOfCoverage, loadCoverageTable } from "../lib/corpus/coverage";

/**
 * Phase 1 acceptance, from implementation.md:
 *   - getCase("347 U.S. 483") returns text > 20,000 chars containing "inherently unequal"
 *   - a second call is served from cache with ZERO network calls
 *   - an out-of-coverage citation yields a TYPED OutOfCoverage signal, not an untyped crash
 *
 * No test here touches the network. `npm test` must pass offline.
 */

/** Unwrap a CorpusFailure and return its typed detail, failing loudly on any other outcome. */
async function failureOf(p: Promise<unknown>): Promise<CorpusError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof CorpusFailure) return err.detail;
    throw err;
  }
  throw new Error("expected a CorpusFailure, but the call resolved successfully");
}

describe("corpus: real corpus text from curated fixtures (offline)", () => {
  it("resolves 347 U.S. 483 to Brown with the full opinion text", async () => {
    const corpus = new Corpus();
    const b = await corpus.getCaseByCitation("347 U.S. 483");
    expect(b.text.length).toBeGreaterThan(20_000);
    expect(b.text).toContain("inherently unequal");
    expect(b.caseName).toContain("Brown");
    expect(b.decisionDate).toBe("1954-05-17");
    expect(b.ocrConfidence).toBeCloseTo(0.664, 3);
  });

  it("costs ZERO network calls, because the curated index resolves the citation", async () => {
    let calls = 0;
    const corpus = new Corpus({
      fetchImpl: (async () => {
        calls++;
        throw new Error("the network must not be touched for a curated fixture");
      }) as unknown as typeof fetch,
    });
    const b = await corpus.getCaseByCitation("347 U.S. 483");
    expect(b.text.length).toBeGreaterThan(20_000);
    expect(calls).toBe(0);
    expect(corpus.networkCalls()).toBe(0);
  });

  it("preserves the frozen ground-truth offset the whole suite rests on", async () => {
    // fixtures/ground-truth.json records foundAtCharOffset 9564 for E1. If this drifts, every
    // span the UI deep-links to is wrong — so the assembly is asserted, not assumed.
    const corpus = new Corpus();
    const b = await corpus.getCaseByCitation("347 U.S. 483");
    expect(b.text.indexOf("Separate educational facilities are inherently unequal.")).toBe(9564);
    // And the capitalisation trap that motivates the normalisation layer (Phase 2):
    expect(b.text.indexOf("separate educational facilities are inherently unequal")).toBe(-1);
  });

  it("resolves Plessy and Anderson too, so MISATTRIBUTED and FABRICATED have source text", async () => {
    const corpus = new Corpus();
    const plessy = await corpus.getCaseByCitation("163 U.S. 537");
    expect(plessy.ocrConfidence).toBeCloseTo(0.434, 3);
    // E2's premise: Brown's holding is genuinely ABSENT from Plessy. Asserted, not assumed.
    expect(plessy.text).not.toContain("inherently unequal");

    const anderson = await corpus.getCaseByCitation("477 U.S. 242");
    expect(anderson.ocrConfidence).toBeCloseTo(0.695, 3);
  });

  it("resolves a citation through a PARALLEL citation key, not just the canonical one", async () => {
    const corpus = new Corpus();
    const viaParallel = await corpus.getCaseByCitation("74 S. Ct. 686");
    expect(viaParallel.caseName).toContain("Brown");
  });
});

describe("corpus: cache behaviour (injected fetch, isolated cache dir)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "citeproof-cache-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const SHA = "d".repeat(64);
  const METADATA: CapMetadataEntry[] = [
    {
      name_abbreviation: "Example v. Sample",
      name: "EXAMPLE v. SAMPLE",
      decision_date: "1954-05-17",
      file_name: "0001-01",
      citations: [{ cite: "163 U.S. 537" }],
      analysis: { sha256: SHA, ocr_confidence: 0.9 },
      court: { name_abbreviation: "U.S." },
    },
  ];
  const CASE: CapCasePayload = {
    ...METADATA[0],
    casebody: { opinions: [{ type: "majority", text: "x".repeat(100) }] },
  };

  /** fetchImpl that answers the two CAP endpoints this layer uses, and counts hits. */
  function capFetch(counter: { n: number }): typeof fetch {
    return (async (url: string) => {
      counter.n++;
      const body = url.endsWith("CasesMetadata.json") ? METADATA : CASE;
      return { status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  function isolated(opts: { counter: { n: number } }) {
    return new Corpus({
      fetchImpl: capFetch(opts.counter),
      cachePaths: {
        fixtures: join(dir, "no-fixtures"),
        runtime: join(dir, "corpus"),
        runtimeIndex: join(dir, "index"),
      },
      sleepImpl: async () => {},
      minIntervalMs: 0,
    });
  }

  it("fetches once, then serves the second call entirely from cache", async () => {
    const counter = { n: 0 };
    const corpus = isolated({ counter });

    const first = await corpus.getCaseByCitation("163 U.S. 537");
    expect(first.text.length).toBe(101);
    // One volume index + one case payload. Nothing else.
    expect(counter.n).toBe(2);
    const afterFirst = counter.n;

    const second = await corpus.getCaseByCitation("163 U.S. 537");
    expect(second.text).toBe(first.text);
    expect(second.sha256).toBe(SHA);
    expect(counter.n).toBe(afterFirst);
    expect(corpus.networkCalls()).toBe(afterFirst);
  });

  it("shares the volume index across two citations in the same volume", async () => {
    const counter = { n: 0 };
    const two: CapMetadataEntry[] = [
      METADATA[0],
      // A DISTINCT sha256 on purpose. Two records sharing one would share a case-cache entry
      // (the cache is sha-keyed, as the phase spec requires) and the second citation would
      // never reach the network — making this test pass for the wrong reason.
      {
        ...METADATA[0],
        name_abbreviation: "Second v. Case",
        file_name: "0002-01",
        citations: [{ cite: "163 U.S. 538" }],
        analysis: { sha256: "f".repeat(64), ocr_confidence: 0.9 },
      },
    ];
    const corpus = new Corpus({
      fetchImpl: (async (url: string) => {
        counter.n++;
        const body = url.endsWith("CasesMetadata.json") ? two : CASE;
        return { status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
      }) as unknown as typeof fetch,
      cachePaths: {
        fixtures: join(dir, "no-fixtures"),
        runtime: join(dir, "corpus"),
        runtimeIndex: join(dir, "index"),
      },
      sleepImpl: async () => {},
      minIntervalMs: 0,
    });

    await corpus.getCaseByCitation("163 U.S. 537");
    const afterFirst = counter.n;
    await corpus.getCaseByCitation("163 U.S. 538");
    // Exactly one more request: the second case body. The volume index was reused.
    expect(counter.n).toBe(afterFirst + 1);
  });

  it("re-fetches nothing when the volume index is already on disk", async () => {
    const counter = { n: 0 };
    await isolated({ counter }).getCaseByCitation("163 U.S. 537");
    const firstRun = counter.n;

    const counter2 = { n: 0 };
    await isolated({ counter: counter2 }).getCaseByCitation("163 U.S. 537");
    expect(counter2.n).toBe(0);
    expect(firstRun).toBe(2);
  });
});

describe("corpus: out-of-coverage is a TYPED signal, never an untyped crash", () => {
  it("reports OutOfCoverage for 999 U.S. 99999 with a boundary that names the reason", async () => {
    const corpus = new Corpus({
      // Proves coverage is decided BEFORE any I/O: reaching the network here would fail loudly.
      fetchImpl: (async () => {
        throw new Error("coverage must be decided without touching the network");
      }) as unknown as typeof fetch,
    });
    const detail = await failureOf(corpus.getCaseByCitation("999 U.S. 99999"));
    expect(detail.kind).toBe("OutOfCoverage");
    if (detail.kind !== "OutOfCoverage") throw new Error("unreachable");
    expect(detail.boundary).toContain("572");
    expect(corpus.networkCalls()).toBe(0);
  });

  it("reports OutOfCoverage for the real 2023 case the corpus cannot reach", async () => {
    // E4. Mata v. Avianca is REAL and post-dates f-supp-3d. This is the assertion that stops
    // the tool accusing the case its own origin story is about.
    const corpus = new Corpus();
    const detail = await failureOf(corpus.getCaseByCitation("678 F. Supp. 3d 443"));
    expect(detail.kind).toBe("OutOfCoverage");
    if (detail.kind !== "OutOfCoverage") throw new Error("unreachable");
    expect(detail.boundary).toContain("2019-08-19");
  });

  it("does NOT claim to separate the fabricated cite from the post-coverage real one", async () => {
    // A measured NEGATIVE result, pinned so nobody builds on it: .recon/probe-slugs.mjs found
    // no page- or volume-based discriminator between E3 (999 U.S. 1234, fabricated) and E4
    // (678 F. Supp. 3d 443, real but unreachable). us reaches page 2722, so 1234 is not
    // structurally absurd. Both must be OutOfCoverage here; telling them apart is Phase 3's.
    const corpus = new Corpus();
    const e3 = await failureOf(corpus.getCaseByCitation("999 U.S. 1234"));
    const e4 = await failureOf(corpus.getCaseByCitation("678 F. Supp. 3d 443"));
    expect(e3.kind).toBe("OutOfCoverage");
    expect(e4.kind).toBe("OutOfCoverage");
  });

  it("reports Unresolved — NOT OutOfCoverage — for a name-only query", async () => {
    // The phase-3 regression seed: we never resolve by case name. This must never become a
    // successful resolution, however the cascade grows.
    const corpus = new Corpus();
    const detail = await failureOf(corpus.getCaseByCitation("Brown v. Board of Education"));
    expect(detail.kind).toBe("Unresolved");
  });

  it("reports Unresolved for a case that resolves but carries no casebody (E6 condition)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "citeproof-e6-"));
    try {
      const empty = { ...({} as CapCasePayload), citations: [{ cite: "163 U.S. 537" }], file_name: "0001-01" };
      const corpus = new Corpus({
        fetchImpl: (async (url: string) => {
          const body = url.endsWith("CasesMetadata.json")
            ? [{ ...empty, analysis: { sha256: "e".repeat(64) } }]
            : empty;
          return { status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
        }) as unknown as typeof fetch,
        cachePaths: {
          fixtures: join(dir, "none"),
          runtime: join(dir, "corpus"),
          runtimeIndex: join(dir, "index"),
        },
        sleepImpl: async () => {},
        minIntervalMs: 0,
      });
      const detail = await failureOf(corpus.getCaseByCitation("163 U.S. 537"));
      expect(detail.kind).toBe("Unresolved");
      expect(detail.message).toContain("no casebody");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("corpus: coverage table is measured, and boundaries come from it", () => {
  const table = loadCoverageTable();

  it("carries the measured boundary dates, not estimates", async () => {
    const corpus = new Corpus();
    expect(await corpus.coverageBoundary("U.S.")).toBe("2014-06-03");
    expect(await corpus.coverageBoundary("F. Supp. 3d")).toBe("2019-08-19");
    expect(await corpus.coverageBoundary("F.2d")).toBe("1993-10-29");
  });

  it("returns null for a reporter it cannot speak to, rather than guessing a date", async () => {
    const corpus = new Corpus();
    expect(await corpus.coverageBoundary("Some Unmapped Reporter")).toBeNull();
  });

  it("records maxPageObserved for every reporter, so the structural check has real data", () => {
    for (const [slug, cov] of Object.entries(table.reporters)) {
      expect(typeof cov.maxVolume, slug).toBe("number");
      expect(cov.latestDecisionDate, slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(cov.maxPageObserved, slug).toBeGreaterThan(0);
    }
    expect(table.reportersEnumerated).toBeGreaterThan(300);
  });

  it("treats an unmapped reporter as out of coverage instead of inventing a boundary", () => {
    const out = detectOutOfCoverage({ reporter: "nope-2d", volume: 1, page: 1 }, table);
    expect(out?.why).toBe("reporter-not-mapped");
  });

  it("applies the decision-date rule when a year is supplied", () => {
    const out = detectOutOfCoverage({ reporter: "us", volume: 347, page: 483, year: 2023 }, table);
    expect(out?.why).toBe("decision-date-beyond-corpus");
    expect(detectOutOfCoverage({ reporter: "us", volume: 347, page: 483, year: 1954 }, table)).toBeNull();
  });
});

describe("corpus: reporter slugs are a measured lookup, never a synthesised pattern", () => {
  it("maps citation spellings to the slugs CAP actually serves", () => {
    expect(citationReporterToSlug("U.S.")).toBe("us");
    expect(citationReporterToSlug("F. Supp. 3d")).toBe("f-supp-3d");
    expect(citationReporterToSlug("F.2d")).toBe("f2d");
    expect(citationReporterToSlug("L. Ed. 2d")).toBe("l-ed-2d");
    expect(citationReporterToSlug("So. 2d")).toBe("so2d");
  });

  it("returns null for slugs that looked plausible but 404'd on the live index", () => {
    // Every one of these was DERIVED from the naming pattern during recon and measured 404.
    // A synthesiser would have silently produced a wrong URL for each.
    for (const bad of ["f-2d", "f-3d", "b-r", "a-2d", "so-2d", "l-ed", "p-2d", "n-e-2d", "f4th", "fed-appx"]) {
      expect(isKnownSlug(bad), bad).toBe(false);
      expect(citationReporterToSlug(bad), bad).toBeNull();
    }
  });

  it("rejects an unmapped reporter rather than falling back to the raw token", () => {
    expect(citationReporterToSlug("N.Y.S.2d")).toBeNull();
  });
});

describe("corpus: parsing rules that protect verdicts from parse artefacts", () => {
  it("parses the citation shapes Phase 2 will hand it, and refuses the rest", () => {
    expect(parseCitationCoordinates("347 U.S. 483")).toEqual({ reporter: "us", volume: 347, page: 483 });
    expect(parseCitationCoordinates("678 F. Supp. 3d 443")).toEqual({
      reporter: "f-supp-3d",
      volume: 678,
      page: 443,
    });
    expect(parseCitationCoordinates("347 U.S. at 495")).toBeNull();
    expect(parseCitationCoordinates("Plessy v. Ferguson")).toBeNull();
    expect(parseCitationCoordinates("999 N.Y.S.2d 12")).toBeNull();
  });

  it("treats whitespace-only opinion text as NO text, not as text", () => {
    expect(hasUsableText({ casebody: { opinions: [{ text: "   \n  " }] } })).toBe(false);
    expect(hasUsableText({ casebody: { opinions: [] } })).toBe(false);
    expect(hasUsableText({})).toBe(false);
    expect(hasUsableText({ casebody: { opinions: [{ text: "real" }] } })).toBe(true);
  });

  it("defaults a MISSING ocr_confidence to 1, so absence of a measurement is not read as bad text", () => {
    // The direction matters: defaulting to 0 would turn every un-analysed case into
    // UNVERIFIABLE and the tool could never accuse anyone.
    const parsed = parseCasePayload({
      citations: [{ cite: "1 F.2d 1" }],
      casebody: { opinions: [{ text: "body" }] },
    });
    expect(parsed.ocrConfidence).toBe(1);
  });

  it("assembles opinion text exactly as the fixtures were assembled", () => {
    expect(
      assembleOpinionText({
        casebody: { opinions: [{ text: "A" }, { text: "B" }], head_matter: "H" },
      }),
    ).toBe("A\nB\nH");
  });

  it("never matches a case by NAME through the citation lookup", () => {
    const metadata: CapMetadataEntry[] = [
      { name_abbreviation: "Brown v. Board of Education", citations: [{ cite: "347 U.S. 483" }] },
    ];
    expect(findCasesByCitation(metadata, "347 U.S. 483")).toHaveLength(1);
    expect(findCasesByCitation(metadata, "Brown v. Board of Education")).toHaveLength(0);
    // Whitespace-insensitive on the citation itself.
    expect(findCasesByCitation(metadata, "347  U.S.   483")).toHaveLength(1);
  });
});

describe("corpus: an AMBIGUOUS cite is refused, never guessed (measured finding)", () => {
  /**
   * `.recon/probe-cite-ambiguity.mjs` on us/572: 803 of 893 distinct cites are claimed by
   * more than one record (max 27). The collisions are DIFFERENT cases sharing a page — SCOTUS
   * orders lists print many dispositions starting on one page, one record each. `572 U.S.
   * 1110` alone matches 13 different cases.
   *
   * This is the most dangerous shape in the whole corpus: silently taking the first match
   * would adjudicate a quotation against the wrong case's text, which is the precise failure
   * CiteProof exists to expose. And it must NOT be reported as "Unresolved", because the
   * precedence rule turns unresolved-but-in-coverage into FABRICATED — i.e. an accusation.
   */
  function ambiguousCorpus(dir: string) {
    const shared: CapMetadataEntry[] = [
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
    ];
    return new Corpus({
      fetchImpl: (async () => {
        throw new Error("an ambiguous cite must be decided without fetching a case body");
      }) as unknown as typeof fetch,
      cachePaths: {
        fixtures: join(dir, "no-fixtures"),
        runtime: join(dir, "corpus"),
        runtimeIndex: join(dir, "index"),
      },
      sleepImpl: async () => {},
      minIntervalMs: 0,
    });
  }

  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "citeproof-ambiguous-"));
    // Write only the volume index into the runtime cache dir the corpus will read.
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

  it("throws Ambiguous with the candidates listed, and fetches no case body", async () => {
    const corpus = ambiguousCorpus(dir);
    const detail = await failureOf(corpus.getCaseByCitation("572 U.S. 1110"));
    expect(detail.kind).toBe("Ambiguous");
    if (detail.kind !== "Ambiguous") throw new Error("unreachable");
    expect(detail.candidates).toHaveLength(2);
    expect(detail.candidates.join(" | ")).toContain("Biton v. Lippert");
    expect(detail.candidates.join(" | ")).toContain("McWilliams v. Schumacher");
  });

  it("does not report Ambiguous as Unresolved (which would become FABRICATED)", async () => {
    const corpus = ambiguousCorpus(dir);
    const detail = await failureOf(corpus.getCaseByCitation("572 U.S. 1110"));
    expect(detail.kind).not.toBe("Unresolved");
  });
});

describe("corpus: the two record shapes are told apart before any field is read", () => {
  it("recognises a curated fixture copy, which has no casebody block", () => {
    const curated = { citation: "347 U.S. 483", text: "opinion text", sha256: "c".repeat(64) };
    expect(isCuratedFixtureRecord(curated)).toBe(true);
    // A raw CAP payload has casebody and must NOT be treated as curated.
    expect(isCuratedFixtureRecord({ casebody: { opinions: [{ text: "x" }] } })).toBe(false);
    expect(isCuratedFixtureRecord({})).toBe(false);
  });

  it("reads a curated fixture's pre-assembled text instead of hunting for casebody", () => {
    const parsed = parseCuratedFixture({
      citation: "347 U.S. 483",
      caseName: "Brown v. Board of Education",
      caseNameFull: "BROWN et al. v. BOARD OF EDUCATION OF TOPEKA et al.",
      decisionDate: "1954-05-17",
      court: "U.S.",
      allCitations: ["347 U.S. 483"],
      sha256: "62aac86a55c144f7f4daa5b58aef9d99735ad5191c0c4e7b63608714ee7ae992",
      ocrConfidence: 0.664,
      text: "body",
    });
    expect(parsed.text).toBe("body");
    expect(parsed.ocrConfidence).toBeCloseTo(0.664, 3);
    expect(parsed.caseName).toContain("Brown");
  });
});
