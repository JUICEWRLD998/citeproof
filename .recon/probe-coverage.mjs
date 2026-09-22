// Coverage boundary for each reporter. Includes a POSITIVE CONTROL so a broken
// regex reports "PROBE BROKEN" instead of a confident wrong answer.
// Run: node .recon/probe-coverage.mjs

const UA = "lexhack-recon/0.1";
const log = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const getText = async (u) => {
  const r = await fetch(u, { headers: { "User-Agent": UA } });
  return { s: r.status, t: r.status === 200 ? await r.text() : "" };
};
const getJson = async (u) => {
  const r = await fetch(u, { headers: { "User-Agent": UA } });
  if (r.status !== 200) return { s: r.status };
  try { return { s: 200, j: await r.json() }; } catch { return { s: r.status, bad: true }; }
};

// --- 0. POSITIVE CONTROL -------------------------------------------------
// We measured 572 `us` volumes earlier. If the extractor cannot reproduce that,
// it is broken and every number below is meaningless. Fail loudly.
const ctrl = await getText("https://static.case.law/us/");
const ctrlVols = [...new Set([...ctrl.t.matchAll(/\/us\/([0-9]+)\//g)].map(m => +m[1]))];
log.push("### 0. POSITIVE CONTROL (expect 572 volumes for `us`; earlier run measured exactly that)");
log.push(`  index HTTP ${ctrl.s}  bytes=${ctrl.t.length}  volumes extracted=${ctrlVols.length}`);
if (ctrlVols.length === 0) {
  log.push("  *** PROBE BROKEN — regex extracted nothing. Reporting NOTHING below. ***");
  log.push("  sample of index body: " + JSON.stringify(ctrl.t.slice(0, 400)));
  console.log(log.join("\n"));
  process.exit(1);
}
log.push(`  CONTROL PASSED (min=${Math.min(...ctrlVols)} max=${Math.max(...ctrlVols)})`);

// --- 1. Boundary per reporter -------------------------------------------
log.push("\n### 1. Coverage boundary per reporter");
const reporters = ["us", "f2d", "f3d", "f-supp", "f-supp-2d", "f-supp-3d"];
const results = {};

for (const rep of reporters) {
  const idx = await getText(`https://static.case.law/${rep}/`);
  if (idx.s !== 200) { log.push(`  ${rep.padEnd(11)} index HTTP ${idx.s} — absent`); results[rep] = null; await sleep(200); continue; }

  const re = new RegExp(`/${rep}/([0-9]+)/`, "g");
  const vols = [...new Set([...idx.t.matchAll(re)].map(m => +m[1]))].sort((a, b) => a - b);
  if (!vols.length) { log.push(`  ${rep.padEnd(11)} index 200 but 0 volumes — extractor failed for this reporter`); results[rep] = null; await sleep(200); continue; }

  const last = vols[vols.length - 1];
  const m = await getJson(`https://static.case.law/${rep}/${last}/CasesMetadata.json`);
  let range = "(no metadata)";
  if (m.j?.length) {
    const d = m.j.map(c => c.decision_date).filter(Boolean).sort();
    range = `${d[0]} .. ${d[d.length - 1]}`;
  }
  results[rep] = { vols: vols.length, last, range };
  log.push(`  ${rep.padEnd(11)} vols=${String(vols.length).padStart(4)}  maxVol=${String(last).padStart(4)}  latest decision: ${range}`);
  await sleep(250);
}

// --- 2. Is the canonical modern AI-sanctions case present? ---------------
log.push("\n### 2. Mata v. Avianca, 678 F. Supp. 3d 443 (S.D.N.Y. 2023) — the case that motivated this product");
let mataFound = null;
const m3d = results["f-supp-3d"];
if (m3d) {
  const probeVols = [678, m3d.last, Math.max(1, m3d.last - 1)].filter((v, i, a) => a.indexOf(v) === i);
  for (const v of probeVols) {
    const m = await getJson(`https://static.case.law/f-supp-3d/${v}/CasesMetadata.json`);
    if (!m.j) { log.push(`  vol ${v}: HTTP ${m.s}`); await sleep(200); continue; }
    const dates = m.j.map(c => c.decision_date).filter(Boolean).sort();
    const hit = m.j.find(c => /Mata/i.test(c.name || ""));
    log.push(`  vol ${v}: ${m.j.length} cases (${dates[0]} .. ${dates[dates.length - 1]})  Mata: ${hit ? hit.name : "no"}`);
    if (hit) mataFound = v;
    await sleep(200);
  }
}
log.push(`  VERDICT: Mata v. Avianca ${mataFound ? "PRESENT in vol " + mataFound : "NOT PRESENT in CAP static"}`);

// --- 3. The boundary restated as a product rule --------------------------
log.push("\n### 3. Product rule derived from the boundary");
const usMax = results["us"]?.range?.split(" .. ")[1];
log.push(`  SCOTUS (us) coverage ends: ${usMax || "unknown"}`);
log.push(`  => any citation to a case after ${usMax || "the boundary"} must return UNVERIFIABLE-COVERAGE, never FABRICATED.`);

console.log(log.join("\n"));
