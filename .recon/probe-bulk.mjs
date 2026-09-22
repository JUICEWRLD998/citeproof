// Probe 5: nail down the two FREE bulk assets that make local verification possible.
// Run: node .recon/probe-bulk.mjs

const UA = "lexhack-recon/0.1 (research)";
const log = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- 1. Is the CL citation-map actually downloadable? Range-request the header bytes.
log.push("### 1. CL bulk citation-map: downloadable + real CSV?");
const cmUrl = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/citation-map-2023-07-31.csv.bz2";
for (const [label, hdrs] of [["HEAD", {}], ["range 0-1023", { Range: "bytes=0-1023" }]]) {
  const r = await fetch(cmUrl, { method: hdrs.Range ? "GET" : "HEAD", headers: { "User-Agent": UA, ...hdrs } });
  log.push(`  ${label}: HTTP ${r.status}  accept-ranges=${r.headers.get("accept-ranges")}  len=${r.headers.get("content-length")}  range=${r.headers.get("content-range")}`);
  if (hdrs.Range && r.status === 206) {
    const b = Buffer.from(await r.arrayBuffer());
    log.push(`  bzip2 magic: ${b.slice(0, 3).toString("hex")} (expect 425a68)`);
  }
  await sleep(400);
}

// ---- 2. Latest available citation-map (newest monthly snapshot)
log.push("\n### 2. Newest citation-map snapshots available");
const lr = await fetch("https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/?list-type=2&prefix=bulk-data/citation-map&max-keys=1000", { headers: { "User-Agent": UA } });
const lt = await lr.text();
const all = [...lt.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]).sort();
log.push(`  total: ${all.length}`);
log.push(`  newest 5:\n    ${all.slice(-5).join("\n    ")}`);
log.push(`  oldest: ${all[0]}`);

// ---- 3. What else is in bulk-data? (opinions? courts? dockets?)
log.push("\n### 3. bulk-data/ inventory (non-citation-map)");
const br = await fetch("https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/?list-type=2&prefix=bulk-data/&max-keys=1000&delimiter=/", { headers: { "User-Agent": UA } });
const bt = await br.text();
const prefixes = [...bt.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)].map(m => m[1]);
log.push("  sub-prefixes:\n    " + prefixes.join("\n    "));
const otherKeys = [...bt.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]).filter(k => !/citation-map/.test(k)).slice(0, 25);
log.push("  non-citation keys (first 25):\n    " + otherKeys.join("\n    "));

// ---- 4. static.case.law structure — try alternate markup + known paths
log.push("\n### 4. static.case.law (Harvard CAP) — real structure");
for (const [label, url] of [
  ["root", "https://static.case.law/"],
  ["/f2d/", "https://static.case.law/f2d/"],
  ["/f2d/240/", "https://static.case.law/f2d/240/"],
  ["/f2d/240/CasesMetadata.json", "https://static.case.law/f2d/240/CasesMetadata.json"],
  ["/us/", "https://static.case.law/us/"],
  ["/us/347/", "https://static.case.law/us/347/"],
  ["/us/347/CasesMetadata.json", "https://static.case.law/us/347/CasesMetadata.json"],
]) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  const t = await r.text();
  log.push(`  ${label}: HTTP ${r.status} len=${t.length} ctype=${r.headers.get("content-type")}`);
  if (r.status === 200 && /json/.test(r.headers.get("content-type") || "")) {
    try {
      const j = JSON.parse(t);
      log.push(`     JSON: ${Array.isArray(j) ? j.length + " items" : Object.keys(j).length + " keys"}`);
      if (Array.isArray(j) && j[0]) {
        log.push(`     keys: ${Object.keys(j[0]).join(", ")}`);
        log.push(`     sample: ${JSON.stringify({ name: j[0].name_abbreviation, cite: j[0].citations?.[0], id: j[0].id, has_casebody: !!j[0].casebody })}`);
      }
    } catch (e) { log.push("     parse fail"); }
  } else if (r.status === 200) {
    const anyHref = [...t.matchAll(/href=["']([^"']+)["']/g)].map(m => m[1]);
    log.push(`     hrefs found: ${anyHref.length}` + (anyHref.length ? ` -> ${anyHref.slice(0, 8).join(", ")}` : ""));
    const dataAttrs = [...t.matchAll(/data-[a-z-]*=["']([^"']{0,60})["']/g)].slice(0, 5).map(m => m[1]);
    if (dataAttrs.length) log.push(`     data attrs: ${dataAttrs.join(" | ")}`);
  }
  await sleep(300);
}

console.log(log.join("\n"));
