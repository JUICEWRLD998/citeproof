// Probe 6: THE decisive test. Does CAP static give us free VERBATIM full opinion text
// at a stable URL, so quote verification can be fully local + keyless?
// Run: node .recon/probe-cap-text.mjs

const UA = "lexhack-recon/0.1 (research)";
const log = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- 1. Find Brown v. Board (347 U.S. 483) in the volume metadata
const meta = await (await fetch("https://static.case.law/us/347/CasesMetadata.json", { headers: { "User-Agent": UA } })).json();
const brown = meta.find(c => /Brown v\. Board/i.test(c.name) || c.citations?.some(x => /^347 U\.S\. 483$/.test(x.cite)));
log.push("### 1. Brown v. Board in /us/347/CasesMetadata.json");
if (brown) {
  log.push("  name:        " + brown.name);
  log.push("  name_abbr:   " + brown.name_abbreviation);
  log.push("  decision:    " + brown.decision_date);
  log.push("  citations:   " + JSON.stringify(brown.citations));
  log.push("  court:       " + JSON.stringify(brown.court));
  log.push("  first_page:  " + brown.first_page + "  last_page: " + brown.last_page);
  log.push("  file_name:   " + brown.file_name);
  log.push("  id:          " + brown.id);
  log.push("  citations count (cites_to len): " + (brown.cites_to || []).length);
  if (brown.cites_to?.[0]) log.push("  cites_to[0]: " + JSON.stringify(brown.cites_to[0]));
  log.push("  analysis keys: " + Object.keys(brown.analysis || {}).join(", "));
} else {
  log.push("  NOT FOUND -- sample names: " + meta.slice(0, 3).map(c => c.name).join(" | "));
}

// --- 2. Fetch the actual case JSON (the full-text path)
if (brown?.file_name) {
  for (const p of [
    `https://static.case.law/us/347/cases/${brown.file_name}.json`,
    `https://static.case.law/us/347/html/${brown.file_name}.html`,
  ]) {
    const r = await fetch(p, { headers: { "User-Agent": UA } });
    const t = await r.text();
    log.push(`\n### 2. ${p.split("/us/347/")[1]}\n  HTTP ${r.status} len=${t.length} ctype=${r.headers.get("content-type")}`);
    if (r.status === 200 && p.endsWith(".json")) {
      try {
        const c = JSON.parse(t);
        log.push("  top keys: " + Object.keys(c).join(", "));
        const cb = c.casebody;
        if (cb) {
          log.push("  casebody keys: " + Object.keys(cb).join(", "));
          log.push("  head_matter len: " + (cb.head_matter || "").length);
          log.push("  opinions: " + (cb.opinions || []).length);
          const op = cb.opinions?.[0];
          if (op) {
            log.push("  opinion keys: " + Object.keys(op).join(", "));
            log.push("  opinion type/author: " + op.type + " / " + op.author);
            log.push("  opinion text len: " + (op.text || "").length);
            log.push("  opinion text head: " + JSON.stringify((op.text || "").slice(0, 300)));
          }
          const whole = (cb.opinions || []).map(o => o.text).join("\n") + "\n" + (cb.head_matter || "");
          // --- 3. THE test: is the famous verbatim quote present?
          for (const q of [
            "separate educational facilities are inherently unequal",
            "inherently unequal",
            "1896",
            "Plessy",
          ]) {
            const n = whole.split(q).length - 1;
            log.push(`  VERBATIM CHECK "${q}": ${n} occurrence(s)`);
          }
          const idx = whole.indexOf("inherently unequal");
          if (idx >= 0) log.push("  context: " + JSON.stringify(whole.slice(Math.max(0, idx - 260), idx + 80)));
        } else {
          log.push("  NO casebody field!");
        }
      } catch (e) { log.push("  parse fail: " + e.message); }
    }
  }
  await sleep(400);
}

// --- 4. Bulk path: per-volume tar.csv (fastest full-corpus ingest?)
log.push("\n### 4. Bulk per-volume CSV (/us/347.tar.csv) -- shape for bulk ingest");
const r4 = await fetch("https://static.case.law/us/347.tar.csv", { headers: { "User-Agent": UA }, method: "HEAD" });
log.push("  HEAD: HTTP " + r4.status + "  len=" + r4.headers.get("content-length") + " (uncompressed CSV)");

// --- 5. Sizing: how big is all of SCOTUS? (decides what we can index in 5 days)
log.push("\n### 5. SCOTUS sizing");
const usIdx = await (await fetch("https://static.case.law/us/", { headers: { "User-Agent": UA } })).text();
const vols = [...new Set([...usIdx.matchAll(/\/us\/(\d+)\//g)].map(m => +m[1]))];
log.push("  volumes: " + vols.length + "  (range " + Math.min(...vols) + "-" + Math.max(...vols) + ")");

// sample 3 volumes' metadata sizes + case counts to extrapolate
let totalCases = 0, sampled = 0;
for (const v of [1, 200, 347, 500]) {
  if (!vols.includes(v)) continue;
  const m = await (await fetch(`https://static.case.law/us/${v}/CasesMetadata.json`, { headers: { "User-Agent": UA } })).json();
  totalCases += m.length; sampled++;
  log.push(`  vol ${v}: ${m.length} cases`);
  await sleep(250);
}
if (sampled) log.push(`  => extrapolated total SCOTUS cases: ~${Math.round(totalCases / sampled * vols.length).toLocaleString()}`);

console.log(log.join("\n"));
