// Phase 1 recon: confirm the CAP reporter slug map EMPIRICALLY instead of assuming the
// naming pattern (fixtures/ground-truth.json knownGaps flags this explicitly), and measure
// each reporter's coverage boundary + observed page range.
//
// Two signals come out of this, and they answer DIFFERENT questions:
//   latestDecisionDate + maxVolume -> "can the corpus reach a case this recent?"
//   maxPageObserved                -> "is this citation STRUCTURALLY possible at all?"
// The second one is what separates a fabricated citation (999 U.S. 1234) from a real case
// the corpus simply stops short of (678 F. Supp. 3d 443). Both are 404; only the page
// range tells them apart. That distinction is Phase 4's to consume, measured here.
//
// Run: node .recon/probe-slugs.mjs
import { writeFileSync } from "node:fs";

const UA = "lexhack-recon/0.1";
const BASE = "https://static.case.law";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reporters worth measuring: the ones a real filing actually cites. Coverage of the
// rest is reported by the enumeration below, but boundaries are only measured here.
const MEASURE = [
  "us", "s-c", "l-ed", "f", "f2d", "f3d", "f-supp", "f-supp-2d", "f-supp-3d",
  "f-appx", "f-2d", "f-3d", "b-r", "a-2d", "n-e-2d", "cal-2d", "so-2d", "p-2d",
  // Deliberately included because earlier recon recorded them as NON-EXISTENT.
  // A slug map that silently accepts a bad slug produces confident wrong answers.
  "f4th", "fed-appx", "nys2d",
];

const get = async (url) => {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.status !== 200) return { status: r.status, text: "", json: null };
    const text = await r.text();
    let json = null;
    if (url.endsWith(".json")) { try { json = JSON.parse(text); } catch { /* leave null */ } }
    return { status: 200, text, json };
  } catch (e) {
    return { status: 0, text: "", json: null, error: e.message };
  }
};

// --- 0. POSITIVE CONTROL ---------------------------------------------------
// The root index must yield the three reporters we already verified by hand in Phase 0.
// If it does not, the enumeration is broken and every number below is worthless.
const root = await get(`${BASE}/`);
// The index serves SINGLE-quoted ABSOLUTE hrefs (href='https://static.case.law/a2d/').
// Matching only double quotes here returned 0 dirs on the first run — the control below
// caught it. Accept either quote style and take the last path segment as the slug.
const dirs = [
  ...new Set(
    [...root.text.matchAll(/href=['"]([^'"]+?)['"]/g)]
      .map((m) => m[1].replace(/\/$/, "").split("/").pop() ?? "")
      .filter((d) => d && !d.startsWith(".") && !d.includes("?")),
  ),
].sort();

console.log("### 0. POSITIVE CONTROL — root index reporter enumeration");
console.log(`  root HTTP ${root.status}  bytes=${root.text.length}  reporter dirs found=${dirs.length}`);
const CONTROL = ["us", "f2d", "f-supp"];
const missing = CONTROL.filter((c) => !dirs.includes(c));
if (missing.length) {
  console.log(`  *** PROBE BROKEN — control reporters missing from enumeration: ${missing.join(", ")} ***`);
  console.log(`  first 400 bytes: ${JSON.stringify(root.text.slice(0, 400))}`);
  process.exit(1);
}
console.log(`  CONTROL PASSED (us, f2d, f-supp all present)`);
console.log(`  discovered: ${dirs.join(" ")}`);

// --- 1. Boundary + page range per reporter ---------------------------------
console.log("\n### 1. Measured boundary and page range per reporter");
const measured = {};
const TARGETS = MEASURE.filter((r) => dirs.includes(r));
const ABSENT = MEASURE.filter((r) => !dirs.includes(r));

for (const rep of TARGETS) {
  const idx = await get(`${BASE}/${rep}/`);
  if (idx.status !== 200) { console.log(`  ${rep.padEnd(12)} index HTTP ${idx.status}`); continue; }

  const vols = [...new Set([...idx.text.matchAll(new RegExp(`/${rep}/([0-9]+)/`, "g"))].map((m) => +m[1]))]
    .sort((a, b) => a - b);
  if (!vols.length) {
    // Not a control failure — a reporter whose index uses a different shape. Say so
    // rather than recording a zero.
    console.log(`  ${rep.padEnd(12)} index 200 but 0 volumes extracted — index shape differs`);
    continue;
  }

  const maxVol = vols[vols.length - 1];
  const meta = await get(`${BASE}/${rep}/${maxVol}/CasesMetadata.json`);
  let latest = null, maxPage = null, cases = 0;
  if (meta.json?.length) {
    cases = meta.json.length;
    const dates = meta.json.map((c) => c.decision_date).filter(Boolean).sort();
    latest = dates[dates.length - 1] ?? null;
    // Page range from the reporter's LAST volume. Volume numbering grows with time and
    // so do page numbers, so the last volume gives the largest page the series reaches.
    const pages = meta.json
      .flatMap((c) => (c.citations || []).map((x) => x.cite))
      .map((c) => parseInt(String(c).match(/\s(\d+)\s*$/)?.[1] ?? "", 10))
      .filter((n) => Number.isFinite(n));
    if (pages.length) maxPage = Math.max(...pages);
  } else {
    console.log(`  ${rep.padEnd(12)} vols=${String(vols.length).padStart(4)} maxVol=${maxVol} — CasesMetadata HTTP ${meta.status}`);
    measured[rep] = { volumes: vols.length, maxVolume: maxVol, latestDecisionDate: null, maxPageObserved: null, metadataStatus: meta.status };
    await sleep(150);
    continue;
  }

  measured[rep] = {
    volumes: vols.length,
    maxVolume: maxVol,
    latestDecisionDate: latest,
    maxPageObserved: maxPage,
    casesInLastVolume: cases,
  };
  console.log(
    `  ${rep.padEnd(12)} vols=${String(vols.length).padStart(4)}  maxVol=${String(maxVol).padStart(4)}  latest=${latest}  maxPageObserved=${maxPage}`,
  );
  await sleep(150);
}

// --- 2. Slugs that must NOT resolve ---------------------------------------
console.log("\n### 2. Non-existent slugs (a slug map must reject these, not guess)");
for (const rep of ABSENT) {
  const idx = await get(`${BASE}/${rep}/`);
  console.log(`  ${rep.padEnd(12)} HTTP ${idx.status}  -> ${idx.status === 404 ? "confirmed absent" : "UNEXPECTED"}`);
  await sleep(100);
}

// --- 3. The structural discriminator, stated as data ----------------------
console.log("\n### 3. The E3/E4 discriminator (both 404 — page range is the only separator)");
const us = measured["us"];
const fs3 = measured["f-supp-3d"];
if (us && fs3) {
  console.log(`  E3  999 U.S. 1234        page 1234 vs us maxPageObserved ${us.maxPageObserved}  -> ${1234 > us.maxPageObserved ? "IMPOSSIBLE" : "plausible"}`);
  console.log(`  E4  678 F. Supp. 3d 443  page  443 vs f-supp-3d maxPageObserved ${fs3.maxPageObserved}  -> ${443 > fs3.maxPageObserved ? "IMPOSSIBLE" : "plausible"}`);
  console.log(`  => page range separates them: ${1234 > us.maxPageObserved && 443 <= fs3.maxPageObserved ? "YES" : "NO — discriminator FAILED, do not build on it"}`);
} else {
  console.log("  could not measure both reporters — discriminator NOT established");
}

const out = {
  $provenance: {
    source: `${BASE}/ + per-reporter cases/<vol>/CasesMetadata.json`,
    probedAt: new Date().toISOString(),
    note: "Measured, not assumed. Regenerate with node .recon/probe-slugs.mjs. Feeds fixtures/coverage.json.",
  },
  allReporterDirs: dirs,
  measured,
  absentSlugs: ABSENT,
};
writeFileSync(".recon/coverage-measured.json", JSON.stringify(out, null, 2));
console.log(`\nwrote .recon/coverage-measured.json (${dirs.length} reporters enumerated, ${Object.keys(measured).length} measured)`);
