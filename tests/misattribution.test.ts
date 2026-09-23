import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditItem, AuditResult } from "../lib/types";
import {
  findBestMatch,
  findTrueHome,
  rankTrueHomes,
  scanForTrueHome,
  verifyTrueHomeCandidates,
} from "../lib/match";
import { auditItem } from "../lib/verdict";
import { Corpus } from "../lib/corpus";
import { parseCitations, parseQuotations, bindQuotations } from "../lib/resolve";

/**
 * Phase 5 acceptance, from implementation.md:
 *   - the fixture sentence planted in the wrong case is recovered to its true home with a deep link
 *   - a genuinely invented sentence returns no candidate and stays FABRICATED
 *
 * Watch item: "a false 'found it elsewhere' is worse than no feature; require an exact normalised
 * match before claiming a new home." Every test below is written against that asymmetry — the
 * failure modes asserted are the ones that would produce a confident wrong home.
 */

const root = process.cwd();
const brief = readFileSync(join(root, "fixtures/briefs/motion-to-dismiss.txt"), "utf8");
const HOLDING = "Separate educational facilities are inherently unequal.";

/**
 * Find the parsed item for a citation, WHITESPACE-INSENSITIVELY.
 *
 * The brief wraps citations across line breaks — it reads `163 U.S.\n537` — so `citation.raw`
 * contains a newline and a plain `includes("163 U.S. 537")` matches nothing. That is the same
 * whitespace trap that made the original ground-truth test report `-1` for every expectation
 * (implementation.md §4 row 15), so it is collapsed here rather than worked around.
 */
function itemFor(items: AuditItem[], citationFragment: string, quoteFragment?: string) {
  const want = normalizeWhitespace(citationFragment);
  return items.find(
    (i) =>
      normalizeWhitespace(i.citation.raw).includes(want) &&
      (quoteFragment === undefined || i.quotation.raw.includes(quoteFragment)),
  );
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** A real case that QUOTES the holding verbatim, added as a fixture in Phase 5. */
const QUOTER = { citation: "671 F.3d 611", name: "McCauley v. City of Chicago", date: "2011-10-20" };
const ORIGIN = { citation: "347 U.S. 483", name: "Brown v. Board of Education", date: "1954-05-17" };

describe("misattribution: a sentence has MANY homes, so the resolver must rank", () => {
  /**
   * The measured premise. `.recon/probe-misattribution.mjs` reported CourtListener returns **123
   * cases** containing Brown's holding. Before the quoter fixture existed the local corpus held
   * exactly one case containing it, so "find the first match" and "find the origin" were
   * indistinguishable and ranking could not be tested against reality at all. Now two real cases
   * contain it, and they are 57 years apart.
   */
  it("finds TWO real cases containing the holding, in both orders of file", () => {
    const hits = scanForTrueHome(HOLDING);
    const citations = hits.map((h) => h.case.citation).sort();
    expect(citations).toEqual([ORIGIN.citation, QUOTER.citation].sort());
    for (const h of hits) {
      // Each hit's span must genuinely contain the sentence in that case's own text. There is no
      // `exact` flag any more: the scan uses the exact matcher, so carrying the flag would be a
      // field that is always `true` by the time anyone reads it. This assertion is the real check.
      expect(h.case.text.slice(h.span.start, h.span.end)).toContain("inherently unequal");
      expect(h.case.text.slice(h.span.start, h.span.end)).toBe(HOLDING);
    }
  });

  it("picks the EARLIEST published case as the origin, not the first one scanned", () => {
    const ranked = rankTrueHomes(HOLDING);
    expect(ranked.home?.case.citation).toBe(ORIGIN.citation);
    expect(ranked.home?.case.decisionDate).toBe(ORIGIN.date);

    // The assertion that makes the previous one meaningful: the scan does NOT return the origin
    // first, so a resolver that took `hits[0]` would name the 2011 quoter as where the line lives.
    // Without this, the ranking test would pass on an implementation that never ranked at all.
    expect(scanForTrueHome(HOLDING)[0].case.citation).toBe(QUOTER.citation);
  });

  it("orders every candidate best-first and keeps the origin at the head", () => {
    const ranked = rankTrueHomes(HOLDING);
    expect(ranked.ranked.map((h) => h.case.citation)).toEqual([ORIGIN.citation, QUOTER.citation]);
    expect(ranked.home).toBe(ranked.ranked[0]);
    // Dates must be non-decreasing across the ranking.
    const dates = ranked.ranked.map((h) => h.case.decisionDate);
    expect([...dates].sort()).toEqual(dates);
  });

  it("is byte-stable across runs, so a report can be re-verified", () => {
    const a = rankTrueHomes(HOLDING).ranked.map((h) => `${h.case.citation}@${h.span.start}`);
    const b = rankTrueHomes(HOLDING).ranked.map((h) => `${h.case.citation}@${h.span.start}`);
    expect(a).toEqual(b);
  });

  it("carries the true home's own TEXT through, so the diff has something to render", () => {
    const home = findTrueHome(HOLDING);
    expect(home).not.toBeNull();
    // A rebuilt/blank case would render an empty diff — the whole point of the feature.
    expect(home!.case.text.length).toBeGreaterThan(20_000);
    expect(home!.case.text.slice(home!.span.start, home!.span.end)).toContain("inherently unequal");
  });
});

describe("misattribution: an invented sentence gets NO home, and stays an accusation", () => {
  it("returns no candidate for E5's invented sentence", () => {
    const invented =
      "the Fourteenth Amendment is not confined to the correction of legislation that operates directly upon the colored race alone.";
    expect(findTrueHome(invented)).toBeNull();
    expect(rankTrueHomes(invented).ranked).toEqual([]);
  });

  it("does not match a PARAPHRASE of a real sentence", () => {
    // E3's fabricated quotation paraphrases a real Anderson sentence. A home found here would be a
    // confident wrong answer — "your invented sentence lives in Anderson" — and is the single
    // worst output this feature can produce.
    const paraphrase =
      "summary judgment is warranted only where the evidence is such that no reasonable jury could return a verdict for the nonmoving party";
    expect(findTrueHome(paraphrase)).toBeNull();
  });

  it("keeps E5 at UNVERIFIABLE_LOW_CONFIDENCE end to end — no home, no accusation", async () => {
    const items = bindQuotations(parseCitations(brief), parseQuotations(brief));
    const e5 = itemFor(items, "163 U.S. 537", "Fourteenth Amendment is not confined");
    expect(e5, "E5's line did not parse").toBeDefined();

    const result = await auditItem(e5!);
    expect(result.verdict).toBe("UNVERIFIABLE_LOW_CONFIDENCE");
    expect(result.verdict).not.toBe("FABRICATED");
    expect(result.trueHome).toBeUndefined();
  });
});

describe("misattribution: the two exclusions that keep a correct citation correct", () => {
  it("never names the CITED case as the true home", () => {
    // If Plessy is not excluded and somehow matches, the verdict logic would be accusing on the
    // strength of the case the document already cited. Exclusion is by every parallel citation.
    const home = findTrueHome(HOLDING, {
      exclude: ["163 U.S. 537", "41 L. Ed. 256", "16 S. Ct. 1138", "1896 U.S. LEXIS 3390"],
    });
    expect(home).not.toBeNull();
    expect(home!.case.citation).toBe(ORIGIN.citation);
  });

  it("excludes by PARALLEL citation too, not just the canonical one", () => {
    // Brown is reachable as 347 U.S. 483 AND 74 S. Ct. 686 AND 98 L. Ed. 2d 873. Excluding only
    // the canonical spelling would let the same case back in through a reporter alias and produce
    // a MISATTRIBUTED verdict naming the case that was already cited.
    const viaParallel = rankTrueHomes(HOLDING, { exclude: ["98 L. Ed. 2d 873", "74 S. Ct. 686"] });
    expect(viaParallel.home?.case.citation).not.toBe(ORIGIN.citation);
    expect(viaParallel.home?.case.citation).toBe(QUOTER.citation);
  });

  it("returns null once every containing case is excluded", () => {
    const home = findTrueHome(HOLDING, { exclude: [ORIGIN.citation, QUOTER.citation] });
    expect(home).toBeNull();
  });
});

describe("misattribution: the exactness requirement is the feature's safety", () => {
  it("surfaces NO near-match as a candidate, since only an exact home may be named", () => {
    // The scan uses the exact matcher, so a near-match does not appear at all. The old design
    // surfaced fuzzy hits flagged `exact: false` and every caller discarded them — a value nobody
    // was allowed to use, costing 524ms per call to compute (measured). Removed; this asserts the
    // behaviour that actually mattered: a near-match yields no candidate and never a named home.
    const nearly = "Separate educational facilities are inherently unequalled in every respect.";
    expect(scanForTrueHome(nearly)).toEqual([]);
    expect(findTrueHome(nearly)).toBeNull();
    expect(rankTrueHomes(nearly).home).toBeNull();

    // And a control proving the emptiness is the matcher's judgement, not an empty corpus: the
    // ONE-WORD-DIFFERENT real sentence IS found, because "unequal" is the word Brown actually uses.
    const real = "Separate educational facilities are inherently unequal.";
    expect(scanForTrueHome(real).length).toBeGreaterThan(0);
  });

  it("finds nothing for a sentence absent from every fixture", () => {
    expect(findTrueHome("no fixture contains this sentence at all, in any case")).toBeNull();
  });

  it("never returns a home from a record with no opinion body", () => {
    // A docket-only caption cannot host a sentence, so it must not be scanned at all.
    for (const h of scanForTrueHome(HOLDING)) {
      expect(h.case.opinionBodyMissing).toBe(false);
      expect(h.case.text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("misattribution: end to end, E2 is recovered with a deep link", () => {
  it("reports MISATTRIBUTED with the true home, its offset, and the losing candidates", async () => {
    const items = bindQuotations(parseCitations(brief), parseQuotations(brief));
    const e2 = itemFor(items, "163 U.S. 537", "inherently unequal");
    expect(e2, "E2's line did not parse").toBeDefined();

    const result = await auditItem(e2!);
    expect(result.verdict).toBe("MISATTRIBUTED");
    expect(result.trueHome?.citation).toBe(ORIGIN.citation);
    expect(result.trueHome?.caseName).toContain("Brown");

    // The deep link: an offset that actually contains the sentence in the true home's text.
    const span = result.foundInOpinion;
    expect(span, "no deep-linkable offset").toBeDefined();
    expect(span!.start).toBe(9564);
    expect(result.trueHome!.text.slice(span!.start, span!.end)).toBe(HOLDING);

    // The competition, so the reader sees that a sentence has many homes and one origin.
    const candidates = result.trueHomeCandidates?.map((c) => c.citation) ?? [];
    expect(candidates).toEqual([ORIGIN.citation, QUOTER.citation]);
    for (const c of result.trueHomeCandidates!) {
      // Every candidate carries its text, so the UI's side-by-side diff can render all of them.
      expect(c.text.length).toBeGreaterThan(0);
    }
  });

  it("states the ranking in the attempt log, so the choice is auditable", async () => {
    const items = bindQuotations(parseCitations(brief), parseQuotations(brief));
    const e2 = itemFor(items, "163 U.S. 537", "inherently unequal");
    const result = await auditItem(e2!);
    const step = result.resolutionTrace?.find((s) => s.source === "cache" && s.outcome === "hit");
    expect(step?.detail).toContain("ranked");
    expect(step?.detail).toContain(ORIGIN.citation);
  });

  it("does NOT scan for a home when the quotation is IN the cited case", async () => {
    // E1: verified. A scan here would be wasted work, and more importantly a hit elsewhere must
    // never be able to downgrade a VERIFIED.
    const items = bindQuotations(parseCitations(brief), parseQuotations(brief));
    const e1 = itemFor(items, "347 U.S. 483");
    const result = await auditItem(e1!);
    expect(result.verdict).toBe("VERIFIED");
    expect(result.trueHome).toBeUndefined();
    expect(result.trueHomeCandidates).toBeUndefined();
    // No cache scan step should appear at all.
    expect(result.resolutionTrace?.some((s) => s.source === "cache")).toBe(false);
  });
});

describe("misattribution: scanning is bounded, so a miss cannot cost minutes", () => {
  it("respects maxCandidates", () => {
    const all = scanForTrueHome(HOLDING, { maxCandidates: 200 });
    const capped = scanForTrueHome(HOLDING, { maxCandidates: 1 });
    expect(capped.length).toBeLessThanOrEqual(all.length);
    expect(capped.length).toBeLessThanOrEqual(1);
  });

  it("returns no candidates rather than throwing when the fixture directory is absent", () => {
    const hits = scanForTrueHome(HOLDING, {
      cachePaths: {
        fixtures: join(root, "fixtures", "not-a-real-directory"),
        runtime: join(root, ".cache", "no-test-runtime"),
        runtimeIndex: join(root, ".cache", "no-test-index"),
      },
    });
    expect(hits).toEqual([]);
    expect(findTrueHome(HOLDING, {
      cachePaths: {
        fixtures: join(root, "fixtures", "not-a-real-directory"),
        runtime: join(root, ".cache", "no-test-runtime"),
        runtimeIndex: join(root, ".cache", "no-test-index"),
      },
    })).toBeNull();
  });
});

describe("misattribution: the CourtListener stage only produces VERIFIED candidates", () => {
  /**
   * `.recon/probe-misattribution.mjs` measured the design constraint for this stage: CL returns the
   * cases that QUOTE a sentence (123 of them for Brown's holding) and carries no opinion text at
   * all (401 on `/opinions/<id>/`). So a CL hit is a LEAD, and it may only become a candidate once
   * its citation is resolved through CAP and the quotation is found verbatim in that text.
   *
   * Every test here is about a hit that must be DISCARDED, because a lead wrongly promoted to a
   * named home is the false "found it elsewhere" the plan calls worse than no feature.
   */
  /**
   * A stand-in for the CL client. Only the one method the cascade uses.
   *
   * The counter is returned as a mutable OBJECT rather than as a getter: destructuring a getter
   * snapshots its value at destructure time, so `const { calls } = fake()` would always read 0 and
   * the "zero requests" assertions would pass while proving nothing.
   */
  function fakeCl(hits: unknown[]) {
    const counter = { calls: 0 };
    return {
      client: {
        searchByCitation: async (_q: string) => {
          counter.calls++;
          return hits as never;
        },
      },
      counter,
    };
  }

  /** A minimal hit for the verification stage. */
  function hit(citations: string[]) {
    return {
      caseName: QUOTER.name,
      citations,
      dateFiled: QUOTER.date,
      court: "7th Cir.",
      docketNumber: null,
      judge: null,
      clusterId: 1,
      snippet: "…",
    };
  }

  it("VERIFIES a hit whose citation resolves AND contains the quotation verbatim", async () => {
    const result = await verifyTrueHomeCandidates(HOLDING, {
      hits: [hit([QUOTER.citation])] as never,
      corpus: new Corpus(),
    });
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0].case.citation).toBe(QUOTER.citation);
    expect(result.attempts[0].outcome).toBe("verified");
  });

  it("DISCARDS a hit whose citation resolves but does NOT contain the quotation", async () => {
    // `477 U.S. 242` (Anderson) is a real case in the corpus that does NOT contain the holding.
    // This is the decisive test: a tool that trusted CL's result count would name Anderson here.
    const result = await verifyTrueHomeCandidates(HOLDING, {
      hits: [hit(["477 U.S. 242"])] as never,
      corpus: new Corpus(),
    });
    expect(result.verified).toEqual([]);
    expect(result.attempts[0].outcome).toBe("not-found-in-text");
  });

  it("DISCARDS a hit carrying NO citation, because it cannot be resolved to text", async () => {
    const result = await verifyTrueHomeCandidates(HOLDING, {
      hits: [hit([])] as never,
      corpus: new Corpus(),
    });
    expect(result.verified).toEqual([]);
    expect(result.attempts[0].outcome).toBe("no-citation");
  });

  it("DISCARDS a hit whose citation the corpus cannot reach", async () => {
    // A real but post-coverage citation — exactly the E4 shape. CL finding it proves nothing.
    const result = await verifyTrueHomeCandidates(HOLDING, {
      hits: [hit(["678 F. Supp. 3d 443"])] as never,
      corpus: new Corpus(),
    });
    expect(result.verified).toEqual([]);
    expect(result.attempts[0].outcome).toBe("unresolvable");
  });

  it("DISCARDS a hit whose citation is the case already cited", async () => {
    const result = await verifyTrueHomeCandidates(HOLDING, {
      hits: [hit(["163 U.S. 537"])] as never,
      corpus: new Corpus(),
      exclude: ["163 U.S. 537"],
    });
    expect(result.verified).toEqual([]);
    expect(result.attempts[0].outcome).toBe("excluded");
  });

  it("bounds CAP lookups, so a long hit list cannot burn the corpus budget", async () => {
    const many = Array.from({ length: 10 }, () => hit([QUOTER.citation]));
    const result = await verifyTrueHomeCandidates(HOLDING, {
      hits: many as never,
      corpus: new Corpus(),
      maxLookups: 2,
    });
    const lookedUp = result.attempts.filter((a) => a.outcome !== "unresolvable");
    expect(lookedUp.length).toBeLessThanOrEqual(2);
    expect(result.attempts.some((a) => a.detail.includes("lookup cap"))).toBe(true);
  });

  it("merges a verified CL candidate into the SAME ranking as local ones", async () => {
    // Merging matters: two ranking rules would be two things to disagree, and the disagreement
    // would surface as a different "true home" depending on whether the cross-check was on. Here
    // McCauley is BOTH local and CL-found, so the union must not list it twice.
    const searched = await verifyTrueHomeCandidates(HOLDING, {
      hits: [hit([QUOTER.citation])] as never,
      corpus: new Corpus(),
    });
    expect(searched.verified).toHaveLength(1);

    const localOnly = rankTrueHomes(HOLDING);
    const merged = rankTrueHomes(HOLDING, { extraCandidates: searched.verified });
    expect(merged.ranked.map((h) => h.case.citation)).toEqual(localOnly.ranked.map((h) => h.case.citation));
    expect(new Set(merged.ranked.map((h) => h.case.citation)).size).toBe(merged.ranked.length);
  });

  it("issues exactly ONE search per audited item, reusing the cascade's hits", async () => {
    // The bug this pins: the cascade's enrichment and this stage's candidate discovery each used to
    // issue their own query, costing TWO requests per item against an anonymous budget of roughly
    // 5/minute. A test caught it. One search per item, reused, is the only version that survives a
    // brief with more than two lines.
    const items = bindQuotations(parseCitations(brief), parseQuotations(brief));
    const e2 = itemFor(items, "163 U.S. 537", "inherently unequal");
    const { client, counter } = fakeCl([hit([QUOTER.citation])]);
    const result = await auditItem(e2!, { crossCheck: client as never, crossCheckEnabled: true });
    expect(result.verdict).toBe("MISATTRIBUTED");
    expect(counter.calls).toBe(1);
  });

  it("does NOT run candidate verification for a VERIFIED line, so no budget is wasted", async () => {
    const items = bindQuotations(parseCitations(brief), parseQuotations(brief));
    const e1 = itemFor(items, "347 U.S. 483");
    const { client, counter } = fakeCl([hit([QUOTER.citation])]);
    const result = await auditItem(e1!, { crossCheck: client as never, crossCheckEnabled: true });
    expect(result.verdict).toBe("VERIFIED");
    // The cascade searched once (enrichment), but the candidate stage must not have run at all.
    expect(counter.calls).toBe(1);
    expect(result.resolutionTrace?.some((s) => s.detail?.startsWith("candidate"))).toBe(false);
  });

  it("is OFF unless explicitly enabled, so the default path costs no third-party budget", async () => {
    const items = bindQuotations(parseCitations(brief), parseQuotations(brief));
    const e2 = itemFor(items, "163 U.S. 537", "inherently unequal");
    const { client, counter } = fakeCl([hit([QUOTER.citation])]);
    const result = await auditItem(e2!, { crossCheck: client as never });
    expect(result.verdict).toBe("MISATTRIBUTED");
    expect(counter.calls).toBe(0);
  });

  it("still recovers the home locally when the cross-check returns nothing", async () => {
    const items = bindQuotations(parseCitations(brief), parseQuotations(brief));
    const e2 = itemFor(items, "163 U.S. 537", "inherently unequal");
    const { client } = fakeCl([]);
    const result = await auditItem(e2!, { crossCheck: client as never, crossCheckEnabled: true });
    expect(result.verdict).toBe("MISATTRIBUTED");
    expect(result.trueHome?.citation).toBe(ORIGIN.citation);
  });

  it("records a throttled cross-check as `skipped`, never as absence of corroboration", async () => {
    const items = bindQuotations(parseCitations(brief), parseQuotations(brief));
    const e2 = itemFor(items, "163 U.S. 537", "inherently unequal");
    const client = {
      searchByCitation: async () => {
        throw new Error("throttled (HTTP 429, retry-after 44s)");
      },
    };
    const result = await auditItem(e2!, { crossCheck: client as never, crossCheckEnabled: true });
    // The local scan still finds the home; the throttle only suppressed the extra source.
    expect(result.verdict).toBe("MISATTRIBUTED");
    const step = result.resolutionTrace?.find((s) => s.outcome === "skipped");
    expect(step?.detail).toContain("throttled");
  });
});

describe("misattribution: the no-citation path still refuses, without scanning", () => {
  it("returns UNVERIFIABLE_UNRESOLVED for an unattributed quotation", async () => {
    const item: AuditItem = {
      id: "q-unbound",
      citation: {
        raw: "",
        volume: 0,
        reporter: "",
        page: 0,
        span: { start: 0, end: 0 },
        shortForm: false,
      },
      quotation: { raw: HOLDING, span: { start: 5, end: 5 + HOLDING.length } },
    };
    const result: AuditResult = await auditItem(item);
    // Even though the sentence DOES live in Brown, a quotation with no citation is a drafting
    // defect, not a misattribution — there is nothing it was misattributed FROM.
    expect(result.verdict).toBe("UNVERIFIABLE_UNRESOLVED");
    expect(result.trueHome).toBeUndefined();
  });
});

describe("misattribution: the quoter fixture is real, and asserts its own premise", () => {
  it("contains the holding byte-for-byte, and post-dates the origin", () => {
    // If the fixture ever stops containing the sentence, every ranking test above would silently
    // collapse to a single candidate and pass for the wrong reason.
    const quoter = JSON.parse(readFileSync(join(root, "fixtures/corpus/f3d-671-0611-01.json"), "utf8"));
    expect(quoter.citation).toBe(QUOTER.citation);
    expect(quoter.text).toContain(HOLDING);
    expect(quoter.decisionDate).toBe(QUOTER.date);
    expect(quoter.decisionDate > ORIGIN.date, "the quoter must be LATER than the origin").toBe(true);

    const origin = JSON.parse(readFileSync(join(root, "fixtures/corpus/us-347-0483-01.json"), "utf8"));
    expect(origin.text).toContain(HOLDING);
  });

  it("is registered in the curated index, so it resolves offline", () => {
    const index = JSON.parse(readFileSync(join(root, "fixtures/corpus/index.json"), "utf8"));
    const entry = index.cases.find((c: { citation: string }) => c.citation === QUOTER.citation);
    expect(entry).toBeDefined();
    expect(entry.reporter).toBe("f3d");
    expect(entry.volume).toBe(671);
  });
});
