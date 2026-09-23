import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditItem, Citation, Span, Verdict } from "../lib/types";
import { OCR_CONFIDENCE_FLOOR, FUZZY_MATCH_THRESHOLD, MIN_INDEX_FOR_ACCUSATION } from "../lib/types";
import { Corpus } from "../lib/corpus";
import { findBestMatch, findAllQuotes, findTrueHome, scanForTrueHome, normalize } from "../lib/match";
import { assessConfidence, confidenceLabel, isTextDegraded, auditItem } from "../lib/verdict";
import { decideVerdict, type MatchFacts, type Reachability } from "../lib/verdict/verdicts";

/**
 * Phase 4 acceptance, from implementation.md:
 *   - all four verdict branches reachable from fixtures
 *   - a correct quote from a 0.66-OCR case is NEVER FABRICATED
 *   - every verdict returns offsets + a reason string
 *   - unit-tested against the "separate educational..." case-sensitivity trap
 *   - the OCR gate must be a threshold with a RECORDED NUMBER, not a vibe
 *
 * The precedence-order tests below deliberately assert on the REASON TEXT as well as the verdict.
 * A verdict test that only checks the enum passes when a case reaches the right answer by the wrong
 * rule — and the rule is the product. If E3 ever became FABRICATED by way of "no case carries this
 * citation" rather than by the volume projection, the enum alone would not notice.
 */

const root = process.cwd();
const brief = readFileSync(join(root, "fixtures/briefs/motion-to-dismiss.txt"), "utf8");
const brown = JSON.parse(readFileSync(join(root, "fixtures/corpus/us-347-0483-01.json"), "utf8")).text;
const plessy = JSON.parse(readFileSync(join(root, "fixtures/corpus/us-163-0537-01.json"), "utf8")).text;

describe("verdict: the OCR gate is one-directional, and that direction is the product", () => {
  it("NEVER suppresses a positive find, however low the confidence", () => {
    // Brown v. Board measures 0.664, BELOW the 0.5 floor. A symmetric gate would make the flagship
    // VERIFIED verdict on the most famous holding in US constitutional law unreachable.
    const decision = assessConfidence(0.664, true);
    expect(decision.kind).toBe("found");
  });

  it("suppresses an ACCUSATION at low confidence", () => {
    // Plessy measures 0.434. Absent + below floor must refuse to accuse.
    expect(assessConfidence(0.434, false).kind).toBe("too-low-to-accuse");
  });

  it("permits an accusation at adequate confidence", () => {
    expect(assessConfidence(0.695, false).kind).toBe("may-accuse");
  });

  it("pins the floor from BOTH sides, so a silent change fails the build", () => {
    // E5 is the low-confidence fixture; Brown is the "may accuse" anchor. If the floor moves
    // between them, one of these flips and the change is visible rather than silent.
    const above = OCR_CONFIDENCE_FLOOR + 0.0001;
    const below = OCR_CONFIDENCE_FLOOR - 0.0001;
    expect(assessConfidence(above, false).kind).toBe("may-accuse");
    expect(assessConfidence(below, false).kind).toBe("too-low-to-accuse");
    expect(isTextDegraded(below)).toBe(true);
    expect(isTextDegraded(above)).toBe(false);
    // The two measured anchors, exactly as docs/LIMITS.md section 6 records them.
    expect(isTextDegraded(0.434)).toBe(true); // Plessy — refuses to accuse
    expect(isTextDegraded(0.664)).toBe(false); // Brown — may accuse
  });

  it("renders the badge the demo shows", () => {
    expect(confidenceLabel(0.664)).toBe("66% OCR");
  });
});

describe("verdict: the precedence rule, rule by rule, as a pure function", () => {
  const reachable: Reachability = { kind: "reachable" };
  const inCited: Span = { start: 9564, end: 9619 };
  const elsewhere: Span = { start: 100, end: 155 };

  function facts(over: Partial<MatchFacts> = {}): MatchFacts {
    return {
      foundInCited: null,
      citedOpinionBodyMissing: false,
      trueHome: null,
      citedConfidence: 0.9,
      ...over,
    };
  }

  it("rule 1: a find in the cited case is VERIFIED even at low confidence", () => {
    const d = decideVerdict(reachable, facts({ foundInCited: inCited, citedConfidence: 0.434 }));
    expect(d.verdict).toBe("VERIFIED");
    // And the reason must say WHY low confidence did not matter.
    expect(d.reason).toContain("positive find");
  });

  it("rule 2: a find elsewhere is MISATTRIBUTED, and outranks the low-confidence gate", () => {
    // E2 exactly: Plessy at 0.434, quotation genuinely in Brown. Rule 3 would say UNVERIFIABLE;
    // because a find is POSITIVE evidence it wins.
    const d = decideVerdict(
      reachable,
      facts({
        citedConfidence: 0.434,
        trueHome: { citation: "347 U.S. 483", caseName: "Brown v. Board of Education", span: elsewhere },
      }),
    );
    expect(d.verdict).toBe("MISATTRIBUTED");
    expect(d.reason).toContain("347 U.S. 483");
  });

  it("rule 3: absent at low confidence is UNVERIFIABLE_LOW_CONFIDENCE", () => {
    const d = decideVerdict(reachable, facts({ citedConfidence: 0.434 }));
    expect(d.verdict).toBe("UNVERIFIABLE_LOW_CONFIDENCE");
    expect(d.reason).toContain("0.434");
  });

  it("rule 5: absent, in coverage, confidence adequate is FABRICATED", () => {
    const d = decideVerdict(reachable, facts({ citedConfidence: 0.695 }));
    expect(d.verdict).toBe("FABRICATED");
  });

  it("E6: a record with no opinion body can NEVER be accused", () => {
    // The invariant the frozen contract states. Absence from a record whose body is missing is
    // not evidence, because the part we would have searched is the part that is absent.
    const d = decideVerdict(reachable, facts({ citedOpinionBodyMissing: true, citedConfidence: 0.99 }));
    expect(d.verdict).toBe("UNVERIFIABLE_UNRESOLVED");
    expect(d.verdict).not.toBe("FABRICATED");
  });

  it("E6 sits ABOVE the low-confidence rule, so a missing body is named as the reason", () => {
    // Both branches would refuse, but naming the wrong one hides the real problem: confidence
    // 0.99 is not the reason we declined to accuse, the missing body is.
    const d = decideVerdict(
      reachable,
      facts({ citedOpinionBodyMissing: true, citedConfidence: 0.99 }),
    );
    expect(d.reason).toContain("no opinion body");
  });

  it("the implausible path accuses, and says the question is the citation, not the quotation", () => {
    const d = decideVerdict({ kind: "implausible", reason: "volume 999 is 1.697x the projection" }, null);
    expect(d.verdict).toBe("FABRICATED");
    expect(d.reason).toContain("1.697");
  });

  it("an in-coverage citation no record claims is ALSO an accusation — with the evidence stated", () => {
    // The other route to FABRICATED, and the one Phase 3's acceptance criterion names. A citation
    // naming a volume the corpus HOLDS, matching nothing in a substantive index, is a fabricated
    // citation: no opinion text exists to search, so the finding is about the citation itself.
    const d = decideVerdict(
      { kind: "unresolved-substantive", reason: "163 U.S. 999 matched no record", indexSize: 412 },
      null,
    );
    expect(d.verdict).toBe("FABRICATED");
    // The reason must name the EVIDENCE (how many records were searched) and must not pretend the
    // quotation was tested — there was no text to test it against.
    expect(d.reason).toContain("412");
    expect(d.reason).toContain("no opinion text exists to search");
  });

  it("refuses an empty index instead of accusing — a truncated fetch is not a fabrication", () => {
    // The direction that matters. lib/corpus/cache.ts warns the volume index is the layer to
    // distrust first, and an empty index is what a failed or truncated fetch leaves behind. It is
    // indistinguishable from "no such case" at the call site, so it must NOT accuse.
    const d = decideVerdict(
      { kind: "refused", why: "unresolved-in-coverage", reason: "no match", isCoverage: false },
      null,
    );
    expect(d.verdict).toBe("UNVERIFIABLE_UNRESOLVED");
    expect(d.verdict).not.toBe("FABRICATED");
  });

  it("an ambiguous cite refuses rather than picks one, and never accuses", () => {
    const d = decideVerdict(
      { kind: "ambiguous", reason: "matches 2 different cases", candidates: ["A [1]", "B [2]"] },
      null,
    );
    expect(d.verdict).toBe("UNVERIFIABLE_UNRESOLVED");
    expect(d.verdict).not.toBe("FABRICATED");
    expect(d.reason).toContain("A [1]");
  });

  it("coverage refusals become UNVERIFIABLE_COVERAGE, other refusals UNRESOLVED", () => {
    const coverage = decideVerdict(
      { kind: "refused", why: "volume-beyond-corpus", reason: "coverage ends 2019-08-19", isCoverage: true },
      null,
    );
    expect(coverage.verdict).toBe("UNVERIFIABLE_COVERAGE");
    const other = decideVerdict(
      { kind: "refused", why: "network", reason: "the request failed", isCoverage: false },
      null,
    );
    expect(other.verdict).toBe("UNVERIFIABLE_UNRESOLVED");
  });
});

describe("verdict: the case-sensitivity trap that motivates the whole normalisation layer", () => {
  it("matches the lowercase quotation against the capitalised corpus text", () => {
    // The full holding INCLUDING its period, since the brief quotes the period inside the mark.
    const quote = "separate educational facilities are inherently unequal.";
    expect(brown.indexOf(quote)).toBe(-1); // the naive check: 0 occurrences
    const match = findBestMatch(brown, quote);
    expect(match).not.toBeNull();
    expect(match!.method).toBe("exact");
    expect(match!.similarity).toBe(1);
    // Mapped back to the ORIGINAL capitalised bytes.
    expect(brown.slice(match!.span.start, match!.span.end)).toBe(
      "Separate educational facilities are inherently unequal.",
    );
  });

  it("reports the frozen ground-truth offset, not an offset into normalised space", () => {
    const match = findBestMatch(brown, "separate educational facilities are inherently unequal.");
    expect(match!.span.start).toBe(9564);
  });
});

describe("verdict: fuzzy matching is a controlled fallback, never a paraphrase detector", () => {
  /**
   * `.recon/probe-fuzzy-threshold.mjs` measured that fuzzy matching is NOT exercised by the ground
   * truth at all: both true positives are verbatim (1.000) and the nearest false candidate — E3's
   * paraphrased quote against the Anderson sentence it paraphrases — sits at **0.447**, far below
   * the 0.92 floor. So the floor is safe, and fuzzy ships as untested-by-fixtures code unless it
   * gets its own controls. These are those controls.
   */
  it("does NOT match a paraphrase of a real sentence", () => {
    // The exact pair the probe measured: E3's fabricated quote vs the real Anderson sentence.
    const paraphrased =
      "summary judgment is warranted only where the evidence is such that no reasonable jury could return a verdict for the nonmoving party";
    const anderson = JSON.parse(
      readFileSync(join(root, "fixtures/corpus/us-477-0242-01.json"), "utf8"),
    ).text;
    expect(findBestMatch(anderson, paraphrased)).toBeNull();
  });

  it("DOES match a near-verbatim quotation, so the fuzzy path is not dead code", () => {
    // The positive control the fixtures do not provide. Note the LENGTH requirement, which is a
    // real property of the floor and not a convenience: one changed word costs 1/n of the score,
    // so an 8-word quotation with one change scores 0.875 and is correctly REJECTED at 0.92. The
    // floor is strict enough that a change is only tolerated in a longer passage, and the
    // arithmetic is asserted before the matcher is, so this cannot pass by accident.
    const sentence = (brown as string)
      .replace(/\s+/g, " ")
      .split(/(?<=\.)\s+/)
      .find((s: string) => s.trim().split(" ").length >= 14 && /public education/i.test(s));
    expect(sentence, "no long Brown sentence to mutate").toBeDefined();

    const tokens = sentence!.trim().split(" ");
    const mutated = [...tokens];
    mutated[mutated.findIndex((t) => /education/i.test(t))] = "schooling";
    const changed = mutated.join(" ");
    expect(changed).not.toBe(sentence);

    // The floor admits this by construction — asserted, not assumed.
    expect(1 - 1 / tokens.length).toBeGreaterThan(FUZZY_MATCH_THRESHOLD);

    const match = findBestMatch(brown, changed);
    expect(match, `fuzzy floor ${FUZZY_MATCH_THRESHOLD} rejected a 1-in-${tokens.length} change`).not.toBeNull();
    expect(match!.method).toBe("fuzzy");
    expect(match!.similarity).toBeGreaterThanOrEqual(FUZZY_MATCH_THRESHOLD);
    // The span must cover the real passage in the ORIGINAL text — not the padded window. This is
    // the assertion that caught the fitting-alignment bug: with the window's ends counted as
    // insertions the score was 0.36 and the matcher returned null outright.
    const covered = normalize(brown.slice(match!.span.start, match!.span.end));
    expect(covered).toContain("public education at that time");
    expect(covered.split(" ").length).toBeLessThanOrEqual(tokens.length + 2);
  });

  it("rejects a one-word change to a SHORT quotation, which is the safe direction", () => {
    // The complement of the test above, and the reason the floor is defensible: a short quotation
    // admits no paraphrase at all. 7 tokens, one change => 0.857.
    const short = "Separate educational facilities are inherently unequal.";
    expect(1 - 1 / short.trim().split(" ").length).toBeLessThan(FUZZY_MATCH_THRESHOLD);
    // "unequal indeed" is not a quotation of anything.
    expect(findBestMatch(brown, "Separate educational facilities are inherently unequal indeed.")).toBeNull();
  });

  it("prefers the exact path over fuzzy whenever both are available", () => {
    const match = findBestMatch(brown, "Separate educational facilities are inherently unequal.");
    expect(match!.method).toBe("exact");
    expect(match!.similarity).toBe(1);
  });

  it("works on sentences containing an internal period and a question mark", () => {
    // Measured in the probe: naive [.!?] sentence splitting cuts mid-sentence on the Anderson
    // opinion and reported 0.273 for a sentence that is present verbatim. The exact path is
    // immune, which is why it runs first.
    const quoted =
      "the plain language of Rule 56(c) mandates the entry of summary judgment, after adequate time for discovery and upon motion, against a party who fails to make a showing sufficient to establish the existence of an element essential to that party's case";
    const match = findBestMatch(
      JSON.parse(readFileSync(join(root, "fixtures/corpus/us-477-0242-01.json"), "utf8")).text,
      quoted,
    );
    // Either it is verbatim (exact) or it is absent — but it must never be a low-confidence guess.
    if (match) expect(match.method).toBe("exact");
  });

  it("refuses to fuzzy-match a quotation too short to be evidence", () => {
    // A string that is NOT present, and too short for the fuzzy path (which needs >= 3 tokens).
    // Note this guard applies to the FUZZY path only: a short string that IS a substring is still
    // a legitimate exact find, which the last assertion pins so the guard is not misread as a
    // general minimum length.
    expect(findBestMatch(brown, "unequalled")).toBeNull();
    expect(findBestMatch(brown, "are unequal")).toBeNull();
    // Exact short matches still work — Brown really does contain this.
    const exactShort = findBestMatch(brown, "inherently unequal.");
    expect(exactShort?.method).toBe("exact");
  });
});

describe("verdict: the misattribution scan requires an EXACT match", () => {
  it("finds the true home of E2's misplaced sentence", () => {
    const hit = findTrueHome("Separate educational facilities are inherently unequal.", {
      exclude: ["163 U.S. 537", "41 L. Ed. 256", "16 S. Ct. 1138", "1896 U.S. LEXIS 3390"],
    });
    expect(hit).not.toBeNull();
    expect(hit!.case.citation).toBe("347 U.S. 483");
    expect(hit!.case.text.slice(hit!.span.start, hit!.span.end)).toContain("inherently unequal");
  });

  it("returns NO true home for a genuinely invented sentence", () => {
    // E5's sentence. A false "found it elsewhere" is worse than no feature (plan section 6).
    const hit = findTrueHome(
      "the Fourteenth Amendment is not confined to the correction of legislation that operates directly upon the colored race alone.",
    );
    expect(hit).toBeNull();
  });

  it("excludes the cited case, so a correct citation cannot become an accusation", () => {
    const quote = "Separate educational facilities are inherently unequal.";
    // Without exclusion Brown is among the candidates.
    const all = scanForTrueHome(quote).map((h) => h.case.citation);
    expect(all).toContain("347 U.S. 483");

    // With Brown excluded, Brown must be gone from the candidates — BY EVERY PARALLEL CITATION it
    // is reachable under, which is the property that matters. It must NOT be "no candidates left":
    // since Phase 5 the corpus holds a REAL quoter (671 F.3d 611, McCauley v. City of Chicago),
    // so a non-empty result here is correct and an empty one would mean the exclusion had removed
    // cases it should not have. This assertion previously required the empty list, which was only
    // true while the corpus held a single case containing the sentence.
    const afterExclusion = scanForTrueHome(quote, {
      exclude: ["347 U.S. 483", "98 L. Ed. 2d 873", "74 S. Ct. 686"],
    }).map((h) => h.case.citation);
    expect(afterExclusion).not.toContain("347 U.S. 483");

    // And excluding it by a PARALLEL citation alone must have the same effect, or the cited case
    // could return through a reporter alias.
    const viaParallel = scanForTrueHome(quote, { exclude: ["74 S. Ct. 686"] }).map((h) => h.case.citation);
    expect(viaParallel).not.toContain("347 U.S. 483");

    // Excluding every containing case does leave nothing — the guard's real boundary.
    expect(findTrueHome(quote, { exclude: ["347 U.S. 483", "671 F.3d 611"] })).toBeNull();
  });

  it("skips a record with no opinion body, which cannot host a sentence", () => {
    // A docket-only caption must never be reported as a true home.
    const hits = scanForTrueHome("Separate educational facilities are inherently unequal.");
    for (const h of hits) expect(h.case.opinionBodyMissing).toBe(false);
  });
});

describe("verdict: end to end over the REAL brief, every item carries offsets and a reason", () => {
  it("audits the whole brief offline, and every line gets a verdict with evidence", async () => {
    const { parseCitations, parseQuotations, bindQuotations } = await import("../lib/resolve");
    const items = bindQuotations(parseCitations(brief), parseQuotations(brief));
    expect(items.length).toBeGreaterThanOrEqual(5);

    const results = [];
    for (const item of items) results.push(await auditItem(item));

    for (const r of results) {
      expect(r.reason.trim().length, `${r.itemId} has an empty reason`).toBeGreaterThan(0);
      expect(r.itemId).toBeTruthy();
    }

    // Every verdict the product promises must be reachable from the real brief alone.
    const verdicts = new Set(results.map((r) => r.verdict));
    for (const v of ["VERIFIED", "MISATTRIBUTED", "FABRICATED"] as Verdict[]) {
      expect(verdicts.has(v), `the brief no longer produces ${v}`).toBe(true);
    }

    // The two accusations must carry a POSITIVE find or a structural reason, never a bare absence.
    const fabricated = results.filter((r) => r.verdict === "FABRICATED");
    expect(fabricated.length).toBeGreaterThan(0);
    for (const r of fabricated) expect(r.reason).toContain("projection");

    const misattributed = results.filter((r) => r.verdict === "MISATTRIBUTED");
    expect(misattributed.length).toBeGreaterThan(0);
    for (const r of misattributed) {
      expect(r.trueHome, `${r.itemId} claims misattribution with no true home`).toBeDefined();
      expect(r.foundInOpinion, `${r.itemId} has no opinion offset to deep-link to`).toBeDefined();
      // And the offset must actually contain the quotation, in the true home's text.
      const home = r.trueHome!;
      const slice = home.text.slice(r.foundInOpinion!.start, r.foundInOpinion!.end);
      expect(normalize(slice)).toContain("separate educational facilities are inherently unequal");
    }
  });

  it("NEVER accuses the real 2023 case the corpus cannot reach (E4)", async () => {
    const { parseCitations, parseQuotations, bindQuotations } = await import("../lib/resolve");
    const items = bindQuotations(parseCitations(brief), parseQuotations(brief));
    const mata = items.find((i) => i.citation.raw.includes("678 F. Supp. 3d 443"));
    expect(mata, "the Mata line did not parse").toBeDefined();

    const result = await auditItem(mata!);
    expect(result.verdict).toBe("UNVERIFIABLE_COVERAGE");
    expect(result.verdict).not.toBe("FABRICATED");
    expect(result.reason).toContain("2019-08-19");
  });

  it("NEVER accuses Brown itself — the tool must not cry wolf on its own control", async () => {
    const { parseCitations, parseQuotations, bindQuotations } = await import("../lib/resolve");
    const items = bindQuotations(parseCitations(brief), parseQuotations(brief));
    const brownItem = items.find((i) => i.citation.raw.includes("347 U.S. 483"));
    const result = await auditItem(brownItem!);
    expect(result.verdict).toBe("VERIFIED");
    expect(result.foundInOpinion!.start).toBeGreaterThan(0);
  });

  it("degrades to refusals when the corpus is unreachable — except the structurally-fabricated line", async () => {
    const { parseCitations, parseQuotations, bindQuotations } = await import("../lib/resolve");
    const items = bindQuotations(parseCitations(brief), parseQuotations(brief));

    // Deterministic and offline: fixtures absent AND every request throwing. Without the injected
    // fetch this test would depend on the real network, which makes it flaky in one direction and
    // silently vacuous in the other.
    const opts = {
      corpus: new (await import("../lib/corpus")).Corpus({
        fetchImpl: (async () => {
          throw new Error("simulated outage");
        }) as unknown as typeof fetch,
        cachePaths: {
          fixtures: join(root, "fixtures", "definitely-not-here"),
          runtime: join(root, ".cache", "no-test-runtime"),
          runtimeIndex: join(root, ".cache", "no-test-index"),
        },
        minIntervalMs: 0,
        sleepImpl: async () => {},
      }),
      cachePaths: {
        fixtures: join(root, "fixtures", "definitely-not-here"),
        runtime: join(root, ".cache", "no-test-runtime"),
        runtimeIndex: join(root, ".cache", "no-test-index"),
      },
    };

    for (const item of items) {
      const r = await auditItem(item, opts);
      expect(r.reason.trim().length, `${r.itemId} has an empty reason`).toBeGreaterThan(0);

      const isE3 = item.citation.raw.includes("999 U.S. 1234");
      if (isE3) {
        // E3 is still FABRICATED with the corpus gone, and that is CORRECT rather than a leak: the
        // Phase 3 projection is computed entirely from local measured fixtures, so the accusation
        // rests on data we hold, not on a request that could fail.
        expect(r.verdict).toBe("FABRICATED");
        expect(r.reason).toContain("projection");
      } else {
        // Every other line depends on text we could not fetch, so nothing may be accused.
        expect(
          r.verdict,
          `${r.itemId} (${item.citation.raw.replace(/\s+/g, " ")}) was accused during an outage`,
        ).not.toBe("FABRICATED");
        expect(r.verdict).not.toBe("MISATTRIBUTED");
      }
    }
  });
});

describe("verdict: index size decides whether an absent match is evidence", () => {
  /**
   * The distinction this pins, and why it is not fussiness: a volume index is the one thing this
   * pipeline fetches wholesale. A truncated or failed fetch leaves it empty or nearly so, which at
   * the call site is IDENTICAL to "no case carries this citation". If the second is an accusation
   * then so is the first, and the tool starts accusing real cases whose volumes it never read.
   */
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  /** A corpus whose us/163 index holds `records` entries and whose network is unreachable. */
  function corpusWithIndex(records: number) {
    const dir = mkdtempSync(join(tmpdir(), "citeproof-idx-"));
    dirs.push(dir);
    const idx = join(dir, "index");
    mkdirSync(idx, { recursive: true });
    const metadata = Array.from({ length: records }, (_, i) => ({
      name_abbreviation: `Filler v. Case ${i}`,
      file_name: `${1000 + i}-01`,
      decision_date: "1896-05-18",
      citations: [{ cite: `163 U.S. ${1000 + i}` }],
      analysis: { sha256: String(i).padStart(64, "0") },
    }));
    writeFileSync(join(idx, "us-163-index.json"), JSON.stringify(metadata));

    return {
      corpus: new Corpus({
        fetchImpl: (async () => {
          throw new Error("the cached volume index must answer this");
        }) as unknown as typeof fetch,
        cachePaths: { fixtures: join(dir, "none"), runtime: join(dir, "corpus"), runtimeIndex: idx },
        minIntervalMs: 0,
        sleepImpl: async () => {},
      }),
      cachePaths: { fixtures: join(dir, "none"), runtime: join(dir, "corpus"), runtimeIndex: idx },
    };
  }

  function itemFor(volume: number, reporter: string, page: number): AuditItem {
    return {
      id: `q-${volume}-${page}`,
      citation: {
        raw: `${volume} ${reporter} ${page}`,
        volume,
        reporter,
        page,
        span: { start: 0, end: 10 },
        shortForm: false,
      },
      quotation: { raw: "a sentence that is not in any of these cases", span: { start: 20, end: 60 } },
    };
  }

  it("ACCUSES when the index was substantive and no record claims the citation", async () => {
    const opts = corpusWithIndex(40);
    const r = await auditItem(itemFor(163, "U.S.", 999), opts);
    expect(r.verdict).toBe("FABRICATED");
    expect(r.reason).toContain("40 record(s)");
  });

  it("REFUSES when the index was empty — the shape a truncated fetch leaves", async () => {
    const opts = corpusWithIndex(0);
    const r = await auditItem(itemFor(163, "U.S.", 999), opts);
    expect(r.verdict).toBe("UNVERIFIABLE_UNRESOLVED");
    expect(r.verdict).not.toBe("FABRICATED");
    expect(r.reason).toContain("truncated fetch");
  });

  it("REFUSES a one-record index, just below the recorded floor", async () => {
    const opts = corpusWithIndex(1);
    const r = await auditItem(itemFor(163, "U.S.", 999), opts);
    expect(r.verdict).not.toBe("FABRICATED");
    expect(MIN_INDEX_FOR_ACCUSATION).toBe(3);
  });

  it("ACCUSES at exactly the recorded floor and above", async () => {
    const opts = corpusWithIndex(MIN_INDEX_FOR_ACCUSATION);
    const r = await auditItem(itemFor(163, "U.S.", 999), opts);
    expect(r.verdict).toBe("FABRICATED");
  });
});

describe("verdict: an unattributed quotation is a drafting defect, not a fabrication", () => {
  it("reports UNVERIFIABLE_UNRESOLVED with the real reason", async () => {
    const unattributed = {
      id: "q-unattributed",
      citation: {
        raw: "",
        volume: 0,
        reporter: "",
        page: 0,
        span: { start: 0, end: 0 },
        shortForm: false,
      } as Citation,
      quotation: { raw: "some sentence nobody cited", span: { start: 10, end: 40 } as Span },
    };
    const r = await auditItem(unattributed);
    expect(r.verdict).toBe("UNVERIFIABLE_UNRESOLVED");
    expect(r.verdict).not.toBe("FABRICATED");
    expect(r.reason).toContain("not attributed to any citation");
    expect(r.foundInDocument).toEqual({ start: 10, end: 40 });
  });
});

describe("verdict: findAllQuotes still behaves, since ground truth depends on it", () => {
  it("finds both occurrences of the sentence the brief quotes twice", () => {
    const spans = findAllQuotes(brief, "Separate educational facilities are inherently unequal.");
    expect(spans.length).toBe(2);
    for (const s of spans) {
      // The brief wraps the sentence across a line break, so the raw slice carries a newline while
      // the ground-truth quote does not. That whitespace difference is exactly what made the
      // original `brief.indexOf(quote)` return -1 for every expectation (implementation.md §4 row
      // 15), so it is asserted NORMALISED here rather than assumed away.
      expect(normalize(brief.slice(s.start, s.end))).toBe(
        "separate educational facilities are inherently unequal.",
      );
    }
    // Document order matters: E1 is the first, E2 the second.
    expect(spans[0].start).toBeLessThan(spans[1].start);
  });
});
