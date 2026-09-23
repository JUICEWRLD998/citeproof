/**
 * probe-misattribution.mjs — Phase 5's evidence base.
 *
 * Two questions the design depends on, both measured rather than assumed.
 *
 * Q1. DOES A QUOTATION APPEAR IN MORE THAN ONE CASE?
 *     The resolver's job is to name where a sentence "actually lives". If every quotation had
 *     exactly one home, ranking would be unnecessary. But recon already showed (implementation.md
 *     §3.4) that CourtListener "ranks the 123 cases that quote Brown above Brown itself" — so in a
 *     real corpus a famous sentence appears in MANY cases, and the resolver must decide which one
 *     is the ORIGIN rather than the first match it happens to read. Measure the real frequency.
 *
 * Q2. CAN A CL QUOTATION SEARCH PRODUCE CANDIDATES AT ALL?
 *     The plan's second stage is "a single budgeted CL search". But CL returns no full text
 *     (401 on /opinions/<id>/), so a CL hit CANNOT be a verified home — at best it is a candidate
 *     citation we must then verify verbatim against CAP. And the E5 sentence is INVENTED, so if CL
 *     returns hits for it, those hits are false leads and must never be reported as a home.
 *
 * Keyless. Re-run: node .recon/probe-misattribution.mjs
 */

import { readFileSync } from "node:fs";

const BASE = "https://www.courtlistener.com/api/rest/v4/search/";
const UA = "citeproof/0.1 (lexhack; phase 5 misattribution probe)";

const gt = JSON.parse(readFileSync("fixtures/ground-truth.json", "utf8"));
const brownHolding = gt.expectations[0].quote; // "Separate educational facilities are inherently unequal."
const invented = gt.expectations[4].quote; // E5 — verified absent from the corpus
const paraphrase = gt.expectations.find((e) => e.id === "E3").quote; // E3 — a paraphrase

async function search(q, type = "o") {
  const url = `${BASE}?q=${encodeURIComponent(q)}&type=${type}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null */
  }
  if (res.status !== 200 || !json) {
    return { status: res.status, count: null, hits: [], retryAfter: res.headers.get("retry-after") };
  }
  return {
    status: res.status,
    count: json.count ?? null,
    hits: (json.results ?? []).slice(0, 8).map((r) => ({
      caseName: r.caseName ?? null,
      citation: Array.isArray(r.citation) ? r.citation : [],
      dateFiled: r.dateFiled ?? null,
    })),
  };
}

console.log("=== Q1: how many cases carry a famous sentence? ===");
console.log(`quoted phrase (${brownHolding.split(" ").length} words): "${brownHolding}"`);
const q1 = await search(`"${brownHolding}"`);
console.log(`status=${q1.status} count=${q1.count}`);
if (q1.retryAfter) console.log(`retry-after=${q1.retryAfter}`);

// The decisive comparison for ranking: the phrase ALONE, and the phrase plus the case that
// originated it. If the count is large, many cases quote it and ranking is load-bearing.
const q1b = await search(`"${brownHolding}" "347 U.S. 483"`);
console.log(`with "347 U.S. 483" appended: count=${q1b.count}`);
console.log(
  q1.count > 3
    ? `→ ${q1.count} cases carry this sentence. The resolver MUST rank: taking the first hit would name a case that merely QUOTES it.`
    : "→ too few to judge ranking from this alone.",
);

console.log("\n=== Q2: what does CL do with an INVENTED sentence? (E5) ===");
console.log(`invented phrase: "${invented.slice(0, 80)}..."`);
await new Promise((r) => setTimeout(r, 13000));
const q2 = await search(`"${invented}"`);
console.log(`status=${q2.status} count=${q2.count}`);
for (const h of q2.hits) console.log(`   · ${h.caseName} ${JSON.stringify(h.citation)} ${h.dateFiled}`);
console.log(
  q2.count > 0
    ? `→ CL returns ${q2.count} hits for a sentence that is in NO case. Any CL-derived candidate is a LEAD, not a finding.`
    : "→ CL correctly returns nothing.",
);

console.log("\n=== Q2b: the E3 PARAPHRASE — does CL 'find' it? ===");
await new Promise((r) => setTimeout(r, 13000));
const q3 = await search(`"${paraphrase}"`);
console.log(`status=${q3.status} count=${q3.count}`);
for (const h of q3.hits.slice(0, 4)) console.log(`   · ${h.caseName} ${JSON.stringify(h.citation)} ${h.dateFiled}`);

console.log("\n=== Q3: what does CL return for the CITATION of a case that quotes it? ===");
// The candidate-verification path: a CL hit gives us a citation, which we must then resolve
// through CAP to read the TEXT. Measured here: are those citations CAP-resolvable shapes?
await new Promise((r) => setTimeout(r, 13000));
const q4 = await search(`"${brownHolding}"`);
const allCitations = q4.hits.flatMap((h) => h.citation);
console.log(`citations carried by the top ${q4.hits.length} hits:`, JSON.stringify(allCitations));
console.log(`hits carrying NO citation at all: ${q4.hits.filter((h) => !h.citation.length).length}`);
console.log(
  "→ a hit with no citation is UNADDRESSABLE: we cannot resolve it to text, so it can never become a home.",
);
