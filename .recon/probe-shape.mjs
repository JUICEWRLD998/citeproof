const UA = "lexhack-recon/0.1";
const log = [];
const g = async (u) => { const r = await fetch(u, { headers: { "User-Agent": UA } }); return { s: r.status, t: await r.text(), c: r.headers.get("content-type") }; };

// 1. Does tar.csv carry full text or metadata only?
const csv = await g("https://static.case.law/us/347.tar.csv");
const lines = csv.t.split("\n");
log.push("### 1. /us/347.tar.csv");
log.push("  bytes=" + csv.t.length + "  lines=" + lines.length);
log.push("  header: " + lines[0].slice(0, 500));
log.push("  row1:   " + (lines[1] || "").slice(0, 350));
log.push("  contains full-text phrase 'inherently unequal'? " + csv.t.includes("inherently unequal"));

// 2. citation graph edges
const meta = await g("https://static.case.law/us/347/CasesMetadata.json");
const j = JSON.parse(meta.t);
const b = j.find(c => (c.citations || []).some(x => x.cite === "347 U.S. 483"));
log.push("\n### 2. Brown found: " + (b ? b.name_abbreviation : "NOT FOUND"));
const edges = (b?.cites_to || []).slice(0, 3);
edges.forEach(e => log.push("  " + e.cite + " -> " + JSON.stringify(e.case_paths) + " ids=" + JSON.stringify(e.case_ids)));
if (edges[0]?.case_paths?.[0]) {
  const cp = edges[0].case_paths[0];                       // e.g. /f-supp/98/0529-01
  const guess = "https://static.case.law" + cp.replace(/^(\/[^/]+\/[^/]+)\/([^/]+)$/, "$1/cases/$2") + ".json";
  log.push("  edge target URL: " + guess);
  const r = await g(guess);
  log.push("  HTTP " + r.s + " len=" + r.t.length);
}

log.push("\n### 3. analysis block (free quality signals)");
log.push("  " + JSON.stringify(b?.analysis));

log.push("\n### 4. bulk assets");
for (const [lbl, u] of [
  ["us/347.tar.csv", "https://static.case.law/us/347.tar.csv"],
  ["us/347.tar", "https://static.case.law/us/347.tar"],
  ["us/347.zip", "https://static.case.law/us/347.zip"],
  ["f2d/240.tar.csv", "https://static.case.law/f2d/240.tar.csv"],
]) {
  const r = await fetch(u, { method: "HEAD", headers: { "User-Agent": UA } });
  log.push("  " + lbl + ": HTTP " + r.s + " len=" + r.headers.get("content-length"));
}
console.log(log.join("\n"));
