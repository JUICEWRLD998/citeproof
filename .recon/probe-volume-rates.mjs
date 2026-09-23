/**
 * probe-volume-rates.mjs — Phase 3's discriminator, measured.
 *
 * THE PROBLEM. The corpus layer returns the SAME typed failure (`OutOfCoverage`) for:
 *   E3  `999 U.S. 1234`          -> ground truth FABRICATED
 *   E4  `678 F. Supp. 3d 443`    -> ground truth UNVERIFIABLE_COVERAGE
 * `.recon/probe-slugs.mjs` already proved no PAGE- or VOLUME-SHAPE check separates them
 * (us reaches page 2722 and f-supp-3d reaches 1326; both cited volumes overshoot their
 * reporter by ~73-75%). The plan's §4 row 12 says "do not build on it".
 *
 * THE QUESTION THIS PROBE ANSWERS. Can a reporter's OWN historical volume-per-year rate
 * project forward far enough to tell "this volume cannot exist yet" from "this volume
 * exists but CAP has not ingested it"? Measured, not assumed — for every mapped reporter.
 *
 * Output feeds fixtures/volume-rates.json, which lib/resolve/cascade.ts reads. Nothing
 * here is guessed; a reporter with no measured span yields null and the cascade must
 * then REFUSE (UNVERIFIABLE_COVERAGE), never accuse.
 *
 * Re-run: node .recon/probe-volume-rates.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";

const BASE = "https://static.case.law";
const UA = "citeproof/0.1 (lexhack; volume-rate probe)";

const coverage = JSON.parse(readFileSync("fixtures/coverage.json", "utf8"));
const slugs = Object.keys(coverage.reporters);

async function meta(slug, vol) {
  const url = `${BASE}/${slug}/${vol}/CasesMetadata.json`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status !== 200) return { status: res.status, dates: [] };
  const json = await res.json();
  if (!Array.isArray(json)) return { status: "not-array", dates: [] };
  const dates = json.map((r) => r.decision_date).filter(Boolean).sort();
  return { status: 200, dates, first: dates[0], last: dates[dates.length - 1] };
}

/** Decimal year, so a rate is not distorted by which month the boundary falls in. */
function decimalYear(iso) {
  if (!iso) return null;
  const [y, m = "1", d = "1"] = iso.split("-");
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isFinite(year)) return null;
  // Day-of-year fraction; good enough for a rate spanning decades.
  const frac = (month - 1) / 12 + (day - 1) / 365;
  return year + frac;
}

const table = {};
console.log("measuring earliest-volume date per reporter (the missing half of the rate)\n");

for (const slug of slugs) {
  const cov = coverage.reporters[slug];
  const first = await meta(slug, 1);
  const lastVol = cov.maxVolume;

  const y0 = decimalYear(first.last ?? first.first);
  const y1 = decimalYear(cov.latestDecisionDate);
  // volumes 1..maxVolume span y0..y1. Volumes advanced = maxVolume - 1.
  const span = y0 != null && y1 != null ? y1 - y0 : null;
  const rate = span && span > 0 ? (lastVol - 1) / span : null;

  table[slug] = {
    maxVolume: lastVol,
    latestDecisionDate: cov.latestDecisionDate,
    maxPageObserved: cov.maxPageObserved,
    firstVolumeDate: first.last ?? first.first ?? null,
    firstVolumeFetchStatus: first.status,
    volumesPerYear: rate == null ? null : Number(rate.toFixed(3)),
  };
  console.log(
    `${slug.padEnd(12)} vol1date=${String(first.last ?? first.first).padEnd(12)} status=${String(first.status).padEnd(4)} maxVol=${String(lastVol).padEnd(5)} span=${span == null ? "n/a" : span.toFixed(1).padEnd(6)} vol/yr=${rate == null ? "n/a" : rate.toFixed(2)}`,
  );
  await new Promise((r) => setTimeout(r, 150));
}

/**
 * Project a reporter's volume count to the citation's asserted year.
 * Returns null when the rate is unmeasured — the caller must then REFUSE, not accuse.
 */
function projectVolume(slug, year) {
  const t = table[slug];
  if (!t || t.volumesPerYear == null || year == null) return null;
  const y1 = decimalYear(t.latestDecisionDate);
  if (y1 == null) return null;
  const ahead = year - y1;
  // A citation asserting a year BEFORE the boundary is not projected at all: it is
  // inside the corpus's era and its absence is a different question.
  if (ahead <= 0) return null;
  return t.maxVolume + t.volumesPerYear * ahead;
}

/**
 * THE BOUND. Measured real citations top out at 1.151 and E3 sits at 1.697, so anything in
 * that interval discriminates. 1.5 is chosen deliberately ABOVE the geometric midpoint
 * (1.398), because the two errors are not symmetric: refusing to adjudicate a fabricated
 * citation is a safe miss, while accusing a real one is the failure this whole product
 * exists to prevent. A real citation landing between 1.15 and 1.5 is refused, not accused.
 *
 * This is NOT statistically derived — it is one fabricated anchor against three real
 * controls, which is why the bound is recorded here with its derivation instead of being
 * sprinkled through the code as a magic number.
 */
const BOUND = 1.5;

const CASES = [
  {
    id: "E3",
    citation: "999 U.S. 1234",
    slug: "us",
    volume: 999,
    year: 2021,
    groundTruth: "FABRICATED",
  },
  {
    id: "E4",
    citation: "678 F. Supp. 3d 443",
    slug: "f-supp-3d",
    volume: 678,
    year: 2023,
    groundTruth: "UNVERIFIABLE_COVERAGE",
  },
  // Controls. If a REAL recent citation is judged implausible, the bound is too tight and
  // the tool would accuse real cases — the worst failure available to it.
  { id: "CTRL-real-us-2021", citation: "593 U.S. 1", slug: "us", volume: 593, year: 2021, groundTruth: "real, unreachable" },
  { id: "CTRL-real-fsupp3d-2022", citation: "650 F. Supp. 3d 1", slug: "f-supp-3d", volume: 650, year: 2022, groundTruth: "real, unreachable" },
  { id: "CTRL-real-fsupp3d-2023", citation: "700 F. Supp. 3d 1", slug: "f-supp-3d", volume: 700, year: 2023, groundTruth: "real, unreachable" },
];

console.log("\n--- projection test (ratio = asserted volume / projected volume) ---\n");
const rows = [];
for (const c of CASES) {
  const projected = projectVolume(c.slug, c.year);
  const ratio = projected == null ? null : c.volume / projected;
  rows.push({ ...c, projected, ratio });
  console.log(
    `${c.id.padEnd(24)} ${c.citation.padEnd(20)} year=${String(c.year).padEnd(5)} projected=${projected == null ? "n/a (REFUSE)" : projected.toFixed(1).padEnd(7)} ratio=${ratio == null ? "n/a" : ratio.toFixed(3)}  [truth: ${c.groundTruth}]`,
  );
}

// The bound must sit ABOVE every real-citation control and BELOW E3. If it cannot, the
// projection does not discriminate and the cascade must refuse for BOTH — which is a
// legitimate but different design, and the evidence for that choice would be this line.
const realRatios = rows.filter((r) => r.id.startsWith("CTRL")).map((r) => r.ratio).filter((r) => r != null);
const maxReal = realRatios.length ? Math.max(...realRatios) : null;
const e3 = rows.find((r) => r.id === "E3");
console.log(`\nmax real-citation ratio = ${maxReal == null ? "n/a" : maxReal.toFixed(3)}`);
console.log(`E3 (fabricated) ratio   = ${e3?.ratio == null ? "n/a" : e3.ratio.toFixed(3)}`);
if (maxReal != null && e3?.ratio != null) {
  console.log(
    maxReal < e3.ratio
      ? `DISCRIMINABLE — a bound in (${maxReal.toFixed(2)}, ${e3.ratio.toFixed(2)}) separates them. Recorded bound: ${BOUND}.`
      : "NOT DISCRIMINABLE — no bound separates the controls from E3. Refuse for both.",
  );
  for (const r of rows.filter((x) => x.ratio != null)) {
    const call = r.ratio > BOUND ? "IMPLAUSIBLE -> may accuse" : "plausible -> REFUSE (safe miss)";
    console.log(`  ${r.id.padEnd(24)} ratio=${r.ratio.toFixed(3)}  ${call}   [truth: ${r.groundTruth}]`);
  }
}

const out = {
  $provenance: {
    source: `${BASE}/<reporter>/1/CasesMetadata.json + fixtures/coverage.json`,
    measuredBy: ".recon/probe-volume-rates.mjs",
    measuredAt: new Date().toISOString(),
    note: "MEASURED per-reporter volume growth, used to project whether a cited volume could exist yet. Read only by lib/resolve/cascade.ts.",
  },
  reporters: table,
  projection: {
    bound: BOUND,
    boundDerivation:
      "Chosen from this probe's measured controls, not statistically derived: real citations top out at 1.151, E3 sits at 1.697, and the bound is set at 1.5 — above the geometric midpoint (1.398) because accusing a real case is the worse error and a safe miss is acceptable. Re-derive before trusting; see docs/LIMITS.md.",
    e3Ratio: e3?.ratio ?? null,
    maxRealControlRatio: maxReal,
  },
};
writeFileSync("fixtures/volume-rates.json", JSON.stringify(out, null, 2) + "\n");
console.log("\nwrote fixtures/volume-rates.json");
