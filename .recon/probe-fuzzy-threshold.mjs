/**
 * probe-fuzzy-threshold.mjs — Phase 4's safety measurement.
 *
 * THE DANGER. §3.5 mandates a fuzzy token-alignment stage at >= 0.92, and Phase 4 must ship it.
 * But a matcher lenient enough to accept one changed word cannot tell a real quotation from a
 * paraphrase, and PARAPHRASED-AS-QUOTED text is exactly what a fabricated citation is attached
 * to. The ground truth already contains such a pair:
 *
 *   E3 quote  "summary judgment is warranted only where the evidence is such that no reasonable
 *              jury could return a verdict for the nonmoving party"
 *   real      Anderson v. Liberty Lobby, 477 U.S. 242 (OCR 0.695), which E3's own fixture note
 *              calls "a PARAPHRASE of a real Anderson holding that our string check does NOT
 *              find in that case either"
 *
 * If fuzzy matching ABOVE 0.92 matches E3's quote into Anderson, then E3 stops being a
 * fabrication fixture and becomes a MISATTRIBUTED one — the ground truth would be violated by
 * the feature the plan requires.
 *
 * THE QUESTION: at what similarity does a real paraphrase cross 0.92? Measure, don't assume.
 * Re-run: node .recon/probe-fuzzy-threshold.mjs
 */

import { readFileSync } from "node:fs";

/** One normalisation, matching lib/match/normalize.ts in spirit: fold, collapse, ASCII quotes. */
function fold(s) {
  return s
    .normalize("NFC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Token-alignment similarity: 1 - (edit distance / max length), on word tokens. */
function tokens(s) {
  return fold(s).split(" ").filter(Boolean);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

function similarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const d = levenshtein(ta, tb);
  return 1 - d / Math.max(ta.length, tb.length);
}

const brief = readFileSync("fixtures/briefs/motion-to-dismiss.txt", "utf8");
const gt = JSON.parse(readFileSync("fixtures/ground-truth.json", "utf8"));
const brown = JSON.parse(readFileSync("fixtures/corpus/us-347-0483-01.json", "utf8")).text;
const plessy = JSON.parse(readFileSync("fixtures/corpus/us-163-0537-01.json", "utf8")).text;
const anderson = JSON.parse(readFileSync("fixtures/corpus/us-477-0242-01.json", "utf8")).text;

/** Split a long opinion into sentences, so we can find the BEST-matching sentence, not the whole. */
function sentences(text) {
  return fold(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(" ").length >= 6);
}

/**
 * The maximum similarity between a quote and ANY sentence in an opinion.
 * This is the honest question: a fuzzy matcher would surface the best candidate, so the
 * threshold has to exclude the best candidate, not the whole-document score.
 */
function bestIn(quote, opinion) {
  let best = 0;
  let bestSentence = "";
  for (const s of sentences(opinion)) {
    // Cheap pre-filter on shared rare word so we do not score 40k pairs per case.
    const sim = similarity(quote, s);
    if (sim > best) {
      best = sim;
      bestSentence = s;
    }
  }
  return { best, bestSentence };
}

console.log("=== 1. TRUE POSITIVES: a real quote vs its own source (must be ~1.0) ===");
const truePairs = [
  ["E1/E2 Brown holding", gt.expectations[0].quote, brown],
  ["E5 Plessy-drafted (absent)", gt.expectations[4].quote, plessy],
];
for (const [label, quote, opinion] of truePairs) {
  const { best, bestSentence } = bestIn(quote, opinion);
  console.log(`${label.padEnd(30)} best=${best.toFixed(3)}  ← "${bestSentence.slice(0, 70)}..."`);
}

console.log("\n=== 2. THE DANGEROUS PAIR: E3's paraphrase vs the REAL Anderson opinion ===");
const e3 = gt.expectations.find((e) => e.id === "E3").quote;
const e3In = bestIn(e3, anderson);
console.log(`E3 quote      : "${e3.slice(0, 90)}..."`);
console.log(`best in Anderson : ${e3In.best.toFixed(3)}`);
console.log(`closest sentence : "${e3In.bestSentence.slice(0, 110)}"`);
console.log(
  e3In.best >= 0.92
    ? `!! E3 CROSSES the 0.92 floor. Shipping 0.92 as-is would turn the fabrication fixture into a misattribution.`
    : `SAFE at 0.92 — E3's paraphrase sits at ${e3In.best.toFixed(3)}, below the floor.`,
);

console.log("\n=== 3. THE PARAPHRASE'S REAL SOURCE SENTENCE (extracted, not recalled) ===");
/**
 * CORRECTION (kept in place). The first version of this probe used a "real Anderson holding"
 * quote written FROM MEMORY, and it scored 0.273 against the opinion — i.e. it was not in the
 * corpus at all, which silently zeroed the true-positive column of the sweep below. That is the
 * exact failure mode this project is about, committed inside our own evidence tooling. The
 * control is now EXTRACTED from the fixture bytes.
 */
const andersonSentences = anderson.split(/(?<=[.!?])\s+/).map((s) => s.replace(/\s+/g, " ").trim());
const realSource = andersonSentences.find((s) => /will not lie if the dispute about a material fact/i.test(s));
if (!realSource) throw new Error("probe is broken: could not extract the real Anderson sentence");
console.log(`extracted real sentence (${realSource.length} chars):`);
console.log(`  "${realSource.slice(0, 140)}..."`);
console.log(`  still in the corpus, verbatim? ${anderson.includes(realSource)}`);
console.log(`  E3's fabricated paraphrase contained verbatim? ${anderson.toLowerCase().includes(e3.toLowerCase())}`);

const realIn = bestIn(realSource, anderson);
console.log(`extracted real sentence vs its own opinion: ${realIn.best.toFixed(3)}`);
const e3VsRealSource = similarity(e3, realSource);
console.log(`E3 paraphrase vs the REAL source sentence : ${e3VsRealSource.toFixed(3)}  ← the margin that matters`);

console.log("\n=== 4. CROSS-CASE NOISE: a real quote vs the WRONG opinion ===");
// E1's Brown holding against Plessy: this is the MISATTRIBUTED fixture's negative side.
console.log(`Brown quote vs Plessy opinion : ${bestIn(gt.expectations[0].quote, plessy).best.toFixed(3)}`);
console.log(`Brown quote vs Anderson       : ${bestIn(gt.expectations[0].quote, anderson).best.toFixed(3)}`);

console.log("\n=== 5. THRESHOLD SWEEP: what each candidate floor admits ===");
const mustFind = [
  ["E1 Brown holding (in Brown)", gt.expectations[0].quote, brown],
  ["real Anderson sentence (in Anderson)", realSource, anderson],
];
const mustNotMatch = [
  ["E3 paraphrase vs Anderson", e3, anderson],
  ["E5 invented vs Plessy", gt.expectations[4].quote, plessy],
  ["E5 invented vs Brown", gt.expectations[4].quote, brown],
  ["E1 Brown quote vs Plessy", gt.expectations[0].quote, plessy],
  ["E1 Brown quote vs Anderson", gt.expectations[0].quote, anderson],
];
for (const floor of [0.92, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5]) {
  const found = mustFind.map(([l, q, o]) => [l, bestIn(q, o).best >= floor]);
  const leaked = mustNotMatch.map(([l, q, o]) => [l, bestIn(q, o).best >= floor]);
  const okFound = found.filter(([, v]) => v).length;
  const badLeak = leaked.filter(([, v]) => v).length;
  console.log(
    `floor ${floor.toFixed(2)}: ${okFound}/${mustFind.length} true finds, ${badLeak}/${mustNotMatch.length} FALSE MATCHES` +
      (badLeak ? `  ← ${leaked.filter(([, v]) => v).map(([l]) => l).join(", ")}` : ""),
  );
}
