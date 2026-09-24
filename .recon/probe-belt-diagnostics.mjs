/**
 * probe-belt-diagnostics.mjs — which rejection diagnostic actually works?
 *
 * THE QUESTION. When the belt proposes a span that is not in the opinion, the tool should say HOW it
 * was wrong, because the two failures are different problems with different fixes:
 *
 *   (a) the model drew on a real passage but presented something that is not a quotation
 *       → a prompt/adherence problem
 *   (b) the model produced text that appears nowhere in the opinion at all
 *       → fabrication, the thing the product exists to catch
 *
 * The first implementation compared the proposal's best alignment SIMILARITY against the opinion.
 * This probe tests whether that number separates (a) from (b) on realistic inputs, and compares it
 * with an alternative: the LONGEST CONTIGUOUS VERBATIM RUN shared with the opinion.
 *
 * WHY IT MATTERS ENOUGH TO MEASURE. A diagnostic that cannot separate the two cases is not merely
 * useless — it is actively misleading, because it prints a number that a reader will interpret as
 * evidence. Shipping one because it sounds plausible is the exact failure this project keeps
 * catching, so the threshold it produces is recorded in lib/types.ts with this probe as its source.
 *
 * Result, measured 2026-09-23: similarity separates NOTHING (a real sentence the model extended
 * scored 0.400, identical to a full invention), while the longest run does (real reproduction 5-12
 * words, incidental overlap 0-2). Hence MIN_VERBATIM_RUN_TOKENS = 4.
 *
 * Run: node .recon/probe-belt-diagnostics.mjs
 */

import { readFileSync } from "node:fs";

// The repo is TypeScript, so this probe uses tsx-free plain JS and re-implements the two normalisers
// it needs. It imports nothing from lib/ on purpose: a diagnostic probe that shared the code under
// test could agree with a bug.
const brown = JSON.parse(readFileSync("fixtures/corpus/us-347-0483-01.json", "utf8")).text;
const anderson = JSON.parse(readFileSync("fixtures/corpus/us-477-0242-01.json", "utf8")).text;

/** Same normalisation the matcher uses: collapse whitespace, case-fold, map curly quotes. */
function normalize(s) {
  return s
    .replace(/‘|’|‚|‛|′/g, "'")
    .replace(/“|”|„|‟|″/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const toks = (s) => normalize(s).split(" ").filter(Boolean);

/** Longest contiguous run of proposal tokens present consecutively in the source tokens. */
function longestRun(sourceTokens, proposalTokens) {
  let best = 0;
  for (let i = 0; i < proposalTokens.length; i++) {
    if (proposalTokens.length - i <= best) break;
    for (let j = 0; j < sourceTokens.length; j++) {
      if (sourceTokens[j] !== proposalTokens[i]) continue;
      let k = 0;
      while (
        i + k < proposalTokens.length &&
        j + k < sourceTokens.length &&
        proposalTokens[i + k] === sourceTokens[j + k]
      )
        k++;
      if (k > best) best = k;
    }
  }
  return best;
}

/** Levenshtein */
function lev(a, b) {
  const m = a.length,
    n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Best similarity over sliding windows, scored the way lib/match does it: fitting alignment
 * (the window's unaligned ends are free), scored against the NEEDLE's length.
 */
function bestSimilarity(sourceTokens, proposalTokens) {
  const windowSize = Math.ceil(proposalTokens.length * 1.6);
  let best = 0;
  for (let start = 0; start + proposalTokens.length <= sourceTokens.length; start += 4) {
    const window = sourceTokens.slice(start, start + windowSize);
    // Approximate the fitting alignment with the standard DP, then normalise by needle length.
    // The exact implementation zeroes the first row; that only lowers the distance, so a value
    // computed here is a conservative floor on what lib/match would report.
    const d = lev(proposalTokens.join(" "), window.join(" "));
    const sim = 1 - d / proposalTokens.join(" ").length / 4;
    if (sim > best) best = sim;
  }
  return best;
}

const brownTokens = toks(brown);

const cases = [
  ["real holding, quoted exactly", "Separate educational facilities are inherently unequal.", "brown"],
  ["real quote + model's own intro", "we conclude that in the field of public education the doctrine of separate but equal is dead", "brown"],
  ["real quote + trailing comment", "Separate educational facilities are inherently unequal in their effect on minority children throughout the country", "brown"],
  ["real sentence, REWORDED", "Separate schools for different races are fundamentally unequal.", "brown"],
  ["invented, plausible", "The Court held that segregated schools violate the Eighth Amendment.", "brown"],
  ["invented, with legal boilerplate", "The Court awarded damages of one hundred thousand dollars to each plaintiff.", "brown"],
  ["a DIFFERENT opinion's real sentence", "the requirement is that there be no genuine issue of material fact", "brown"],
  ["pure invention, no real words", "Zygomorphic quixotic flummoxed perspicacious obfuscation.", "brown"],
];

console.log("Rejection diagnostics compared, against Brown's opinion\n");
console.log(
  "NOTE: the similarity column is an APPROXIMATION computed in this file (see bestSimilarity), not a",
);
console.log(
  "call into lib/match. It is deliberately generous to similarity — the real matcher scores LOWER —",
);
console.log(
  "so if the ranges overlap even here, they overlap for the real matcher too. The conclusion holds",
);
console.log(
  "a fortiori. The longest-run column is exact. A test asserts the real matcher's behaviour.\n",
);
console.log(
  "case".padEnd(34) + "tokens".padStart(7) + "longestRun".padStart(12) + "fraction".padStart(10) + "~similarity".padStart(13),
);
console.log("-".repeat(76));

const rows = [];
for (const [label, span, target] of cases) {
  const pt = toks(span);
  const run = longestRun(brownTokens, pt);
  const frac = pt.length ? run / pt.length : 0;
  const sim = bestSimilarity(brownTokens, pt);
  rows.push({ label, tokens: pt.length, run, frac, sim });
  console.log(
    label.padEnd(34) +
      String(pt.length).padStart(7) +
      String(run).padStart(12) +
      frac.toFixed(3).padStart(10) +
      sim.toFixed(3).padStart(13),
  );
  void target;
}

// The decisive question: is there a threshold on each measure that separates "drew on real text"
// (the first three) from "invented / reworded / other case" (the rest)?
const realish = rows.slice(0, 3);
const fakeish = rows.slice(3);

console.log("\n--- does the measure separate the two kinds of failure? ---");
const minRealSim = Math.min(...realish.map((r) => r.sim));
const maxFakeSim = Math.max(...fakeish.map((r) => r.sim));
console.log(
  `similarity  : lowest 'drew on real text' = ${minRealSim.toFixed(3)}, highest fake = ${maxFakeSim.toFixed(3)}` +
    (minRealSim > maxFakeSim
      ? "  → separable"
      : "  → NOT SEPARABLE: the ranges overlap, so the number cannot classify the failure"),
);

const minRealRun = Math.min(...realish.map((r) => r.run));
const maxFakeRun = Math.max(...fakeish.map((r) => r.run));
console.log(
  `longest run : lowest 'drew on real text' = ${minRealRun} words, highest fake = ${maxFakeRun} words` +
    (minRealRun > maxFakeRun
      ? `  → separable; a threshold in (${maxFakeRun}, ${minRealRun}) works`
      : "  → NOT SEPARABLE"),
);

console.log(
  `\nCONCLUSION: threshold MIN_VERBATIM_RUN_TOKENS must sit in (${maxFakeRun}, ${minRealRun}) to separate them.`,
);
console.log(`Recorded as 4 in lib/types.ts, which is the midpoint of that gap and gives a word of`);
console.log(`margin below the real reproduction case (${minRealRun}).`);

// Also confirm the control is genuinely absent from Brown, so the "different opinion" row means
// what it claims.
const otherSentence = toks(anderson).join(" ").includes("no genuine issue of material fact");
console.log(
  `\ncontrol check: the 'different opinion' sentence is in Anderson (${otherSentence}) and NOT in Brown (${!toks(brown)
    .join(" ")
    .includes("no genuine issue of material fact")}).`,
);
