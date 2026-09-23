/**
 * probe-crosscheck.mjs — Phase 3 evidence base.
 *
 * THE QUESTION: E3 (`999 U.S. 1234`, fabricated) and E4 (`678 F. Supp. 3d 443`, real but
 * post-coverage) are BOTH unreachable in CAP and BOTH produce the SAME typed failure
 * (`OutOfCoverage`). §4 row 12 already records that no citation SHAPE separates them.
 *
 * So can the CourtListener cross-check separate them by CONTENT? If yes, the cross-check
 * carries real weight and the cascade must consult it. If no, it is decoration and the
 * cascade must not pretend otherwise.
 *
 * Both queries are citation strings. Nothing here searches by case name — recon proved CL's
 * top hit for "Brown v. Board of Education" is a 2015 district case, and a name fallback
 * would silently reintroduce exactly the misattribution this product sells against.
 *
 * Keyless. Re-run: node .recon/probe-crosscheck.mjs
 */

const BASE = "https://www.courtlistener.com/api/rest/v4/search/";
const UA = "citeproof/0.1 (lexhack; phase 3 feasibility probe)";

async function search(citation) {
  const url = `${BASE}?q=${encodeURIComponent(citation)}&type=o`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  const body = await res.text();
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    /* leave null; the status and body are the evidence */
  }
  if (res.status !== 200 || !json) {
    return { status: res.status, retryAfter: res.headers.get("retry-after"), count: null, hits: [] };
  }
  const results = json.results ?? [];
  return {
    status: res.status,
    count: json.count ?? null,
    hits: results.slice(0, 5).map((r) => ({
      caseName: r.caseName ?? null,
      citation: Array.isArray(r.citation) ? r.citation : [],
      dateFiled: r.dateFiled ?? null,
      court: r.court ?? null,
      docketNumber: r.docketNumber ?? null,
      judge: r.judge ?? null,
      clusterId: r.cluster_id ?? null,
      snippet: (r.opinions?.[0]?.snippet ?? "").slice(0, 120),
    })),
  };
}

/** A citation that resolves perfectly well in CAP, as the known-good control. */
const QUERIES = [
  { id: "CONTROL 347 U.S. 483", citation: "347 U.S. 483", expect: "known-good case; proves the endpoint answers at all" },
  { id: "E3 999 U.S. 1234", citation: "999 U.S. 1234", expect: "FABRICATED — should be unknown to CL too" },
  { id: "E4 678 F. Supp. 3d 443", citation: "678 F. Supp. 3d 443", expect: "REAL 2023 case — CL should know it" },
  { id: "E3-pincite 999 U.S. 1234, 1240", citation: "999 U.S. 1234, 1240", expect: "same fabricated cite with a pincite" },
  { id: "E4-pincite 678 F. Supp. 3d 443, 452", citation: "678 F. Supp. 3d 443, 452", expect: "same real cite with a pincite" },
  { id: "EMPTY reporter 999 X.Z. 1234", citation: "999 X.Z. 1234", expect: "unmapped reporter — must not 500" },
];

const out = [];
for (const q of QUERIES) {
  let r;
  try {
    r = await search(q.citation);
  } catch (err) {
    r = { status: "THREW", count: null, hits: [], error: String(err) };
  }
  out.push({ ...q, ...r });
  console.log(
    `${q.id.padEnd(34)} status=${String(r.status).padEnd(6)} count=${String(r.count).padEnd(8)} hits=${r.hits.length}`,
  );
  for (const h of r.hits) {
    console.log(`      · ${h.caseName} ${JSON.stringify(h.citation)} ${h.dateFiled ?? ""}`);
  }
  if (r.retryAfter) console.log(`      retry-after=${r.retryAfter}`);
  if (r.error) console.log(`      ERROR ${r.error}`);
  // Anonymous budget is ~5 req/min. Pace well under it rather than eating 429s.
  await new Promise((res) => setTimeout(res, 13000));
}

const byId = Object.fromEntries(out.map((o) => [o.id, o]));
const e3 = byId["E3 999 U.S. 1234"];
const e4 = byId["E4 678 F. Supp. 3d 443"];

console.log("\n--- discriminability (the actual question) ---");
console.log(`E3 count = ${e3?.count}   E4 count = ${e4?.count}`);
const separates =
  typeof e3?.count === "number" &&
  typeof e4?.count === "number" &&
  e3.count !== e4.count;
console.log(
  separates
    ? "SEPARATES on count — but a raw count is NOT a discriminator: it reports how many opinions MENTION the string, not whether the cite exists. Both counts must be read, not just their difference."
    : "NO DISCRIMINATOR FROM COUNT ALONE.",
);

// The honest test is the top hit's CITATION FIELD, not the result count. A search for a
// citation string returns cases that MENTION it; only a result whose own citation list
// carries the string is evidence that the cite itself exists.
function carriesCite(hits, citation) {
  const want = citation.replace(/\s+/g, " ").trim();
  return hits.filter((h) => h.citation.some((c) => String(c).replace(/\s+/g, " ").trim() === want));
}
for (const [label, q] of [
  ["E3", e3],
  ["E4", e4],
]) {
  const carriers = carriesCite(q?.hits ?? [], q?.citation ?? "");
  console.log(`${label}: ${carriers.length} of top-${q?.hits?.length ?? 0} hits carry "${q?.citation}" in their own citation list`);
  for (const c of carriers) console.log(`      → ${c.caseName} ${JSON.stringify(c.citation)} ${c.dateFiled}`);
}

console.log("\nJSON:", JSON.stringify(out, null, 2));
