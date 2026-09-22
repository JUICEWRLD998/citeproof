// Phase 0: verify fixture facts + record the real CAP coverage boundary.
// Run: node .recon/probe-phase0.mjs

const UA = "lexhack-recon/0.1";
const log = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getj = async (u) => {
  const r = await fetch(u, { headers: { "User-Agent": UA } });
  if (r.status !== 200) return { status: r.status };
  try { return { status: 200, j: await r.json() }; } catch { return { status: r.status }; }
};

// ---- 1. Confirm Plessy v. Ferguson cite + pull a real distinctive sentence
const m163 = await getj("https://static.case.law/us/163/CasesMetadata.json");
log.push("### 1. us/163 -> Plessy?");
if (m163.j) {
  const pl = m163.j.find(c => /Plessy/i.test(c.name || ""));
  if (pl) {
    log.push("  name:      " + pl.name);
    log.push("  citations: " + JSON.stringify(pl.citations));
    log.push("  decision:  " + pl.decision_date);
    log.push("  file_name: " + pl.file_name);
    log.push("  ocr_conf:  " + pl.analysis?.ocr_confidence);
    const c = await getj(`https://static.case.law/us/163/cases/${pl.file_name}.json`);
    if (c.j?.casebody?.opinions?.length) {
      log.push("  opinions:  " + c.j.casebody.opinions.length);
      const t = c.j.casebody.opinions.map(o => o.text).join("\n") + "\n" + (c.j.casebody.head_matter || "");
      log.push("  total text len: " + t.length);
      for (const q of ["separate but equal", "equal but separate", "inherently unequal", "Fourteenth Amendment"]) {
        log.push(`  "${q}": ${t.split(q).length - 1} occurrence(s)`);
      }
      const i = t.indexOf("separate but equal");
      if (i >= 0) log.push("  ctx: " + JSON.stringify(t.slice(Math.max(0, i - 300), i + 150)));
      // distinctive extractable sentence for a fixture
      const m = t.match(/[A-Z][^.!?]{120,240}\./);
      if (m) log.push("  candidate fixture sentence: " + JSON.stringify(m[0]));
    }
  } else {
    log.push("  NOT FOUND. sample: " + m163.j.slice(0, 3).map(c => c.name).join(" | "));
  }
}

// ---- 2. COVERAGE BOUNDARY: newest `us` volumes and their decision dates
log.push("\n### 2. `us` reporter coverage boundary");
const idx = await fetch("https://static.case.law/us/", { headers: { "User-Agent": UA } });
const html = await idx.text();
const vols = [...new Set([...html.matchAll(/\/us\/(\d+)\//g)].map(m => +m[1]))].sort((a, b) => a - b);
log.push("  volumes: " + vols.length + "  min=" + vols[0] + "  max=" + vols[vols.length - 1]);
for (const v of vols.slice(-4)) {
  const m = await getj(`https://static.case.law/us/${v}/CasesMetadata.json`);
  if (m.j?.length) {
    const dates = m.j.map(c => c.decision_date).filter(Boolean).sort();
    log.push(`  vol ${v}: ${m.j.length} cases, decision_date ${dates[0]} .. ${dates[dates.length - 1]}`);
  } else {
    log.push(`  vol ${v}: NO METADATA (status ${m.status})`);
  }
  await sleep(200);
}

// ---- 3. Other reporter coverage (does f2d / f-supp reach the modern era?)
log.push("\n### 3. Other reporter boundaries");
for (const rep of ["f2d", "f-supp", "f3d", "f4th", "fed-appx"]) {
  const r = await fetch(`https://static.case.law/${rep}/`, { headers: { "User-Agent": UA } });
  if (r.status !== 200) { log.push(`  ${rep}: HTTP ${r.status}`); continue; }
  const t = await r.text();
  const vs = [...new Set([...t.matchAll(new RegExp(`/${rep}/(\\d+)/`, "g"))].map(m => +m[1]))].sort((a, b) => a - b);
  log.push(`  ${rep}: volumes=${vs.length} min=${vs[0]} max=${vs[vs.length - 1]}`);
  await sleep(200);
}

// ---- 4. Does a MODERN case exist? (defines what we must call UNVERIFIABLE)
log.push("\n### 4. Modern-era probe (Mata v. Avianca, 678 F. Supp. 3d 443 (S.D.N.Y. 2023))");
for (const rep of ["f-supp-3d", "f-supp-2d", "f-supp"]) {
  const r = await fetch(`https://static.case.law/${rep}/`, { headers: { "User-Agent": UA } });
  log.push(`  ${rep}: HTTP ${r.status}`);
}

console.log(log.join("\n"));
