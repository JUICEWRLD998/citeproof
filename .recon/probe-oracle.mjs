// Probe 4: rigorously establish the CENTERPIECE claim, then map bulk-data + auth tier.
// Claim under test: CL search cannot be used as a verbatim-quote oracle.
// Run: node .recon/probe-oracle.mjs

const UA = "lexhack-recon/0.1 (research)";
const log = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function search(q, extra = "") {
  const u = `https://www.courtlistener.com/api/rest/v4/search/?q=${encodeURIComponent(q)}${extra}&type=o`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.status === 429) { await sleep(3000); continue; }
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { error: t.slice(0, 120) }; }
  }
  return { error: "rate-limited" };
}

// --- 1. Word-count monotonicity: if search were AND-exact-phrase, adding words must
//        narrow results sharply. OR/analyzed search stays broad. This distinguishes them.
const base = "the court has jurisdiction over the parties";
const wide = [];
for (const n of [4, 6, 8, 10]) {
  const words = base.split(" ").slice(0, n).join(" ");
  const r = await search(`"${words}"`);
  wide.push({ n, q: words, count: r.count ?? "ERR" });
  await sleep(700);
}
log.push("### 1. Result count vs. quoted-phrase length (AND-exact would collapse toward 0)");
for (const w of wide) log.push(`  ${w.n} words: count=${w.count}   "${w.q}"`);

// --- 2. The killer control: a sentence that CANNOT exist in any opinion.
//        A real exact-phrase engine must return 0. Analyzed/OR search will not.
const impossible = [
  "zqxq wibble frobnicate the jurisprudence of zqxq",
  "the quick brown fox jumps over the lazy judge",
  "banana helicopter jurisprudence standard of review",
];
log.push("\n### 2. Sentences that CANNOT occur in an opinion (exact engine must return 0)");
for (const q of impossible) {
  const r = await search(`"${q}"`);
  log.push(`  count=${r.count}  "${q}"`);
  if (r.results?.[0]) log.push(`     top: ${r.results[0].caseName} (${r.results[0].dateFiled})`);
  await sleep(700);
}

// --- 3. Verbatim quote from a case we can confirm exists, vs. a 1-word corruption of it.
log.push("\n### 3. Real quote vs. single-word corruption (both quoted)");
const real = "separate educational facilities are inherently unequal";
const corrupt = "separate educational facilities are inherently unlawful";
for (const q of [real, corrupt]) {
  const r = await search(`"${q}"`);
  log.push(`  count=${r.count}  "${q}"`);
  const names = (r.results || []).slice(0, 3).map(x => `${x.caseName} (${x.dateFiled})`);
  log.push(`     top3: ${names.join(" | ")}`);
  await sleep(700);
}

// --- 4. Does CL expose an exact-phrase / proximity operator? Probe the documented fields.
log.push("\n### 4. Operator probes");
for (const [label, q, extra] of [
  ["plain", real, ""],
  ["+phrase (lucene-ish)", `+"${real}"`, ""],
  ["AND-quoted", `"${real}"&q2=x`, ""],
  ["exact via type=o & order_by=score desc", real, "&order_by=score%20desc"],
]) {
  const r = await search(q, extra);
  log.push(`  ${label}: count=${r.count}  (${q.slice(0, 40)})`);
  await sleep(700);
}

// --- 5. bulk-data/ prefix => can we build a verbatim corpus for free?
log.push("\n### 5. CourtListener bulk data (free, no key?)");
for (const [label, url] of [
  ["bulk-data/ listing", "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/?list-type=2&prefix=bulk-data/&max-keys=40"],
  ["scotus/ listing", "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/?list-type=2&prefix=scotus/&max-keys=20"],
]) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  const t = await r.text();
  const keys = [...t.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
  const sizes = [...t.matchAll(/<Size>(\d+)<\/Size>/g)].map(m => +m[1]);
  log.push(`  ${label}: HTTP ${r.status}, ${keys.length} keys`);
  keys.slice(0, 12).forEach((k, i) => log.push(`     ${k}  (${(sizes[i] / 1e6).toFixed(1)} MB)`));
}

// --- 6. Auth tier: what does an unauthenticated opinion-detail request say, and is
//        there a documented free tier? (We test the response, not assume.)
log.push("\n### 6. Auth requirement on the endpoints that carry full text");
for (const [label, url] of [
  ["v4 opinions/<id>/", "https://www.courtlistener.com/api/rest/v4/opinions/105312/"],
  ["v4 clusters/<id>/", "https://www.courtlistener.com/api/rest/v4/clusters/105312/"],
  ["v4 search (works?)", "https://www.courtlistener.com/api/rest/v4/search/?q=test&type=o"],
]) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const t = await r.text();
  log.push(`  ${label}: HTTP ${r.status}  ${t.slice(0, 110)}`);
  await sleep(700);
}

console.log(log.join("\n"));
