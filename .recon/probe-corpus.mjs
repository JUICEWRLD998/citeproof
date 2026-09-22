// Probe 3: map the two OPEN corpora that actually answered, and test quote-level search.
// Run: node .recon/probe-corpus.mjs

const UA = "lexhack-recon/0.1 (research)";
const log = [];

const get = async (label, url, opts = {}) => {
  try {
    const r = await fetch(url, { ...opts, headers: { "User-Agent": UA, ...(opts.headers || {}) } });
    const text = await r.text();
    log.push(`\n### ${label}\nHTTP ${r.status} len=${text.length} ${url}`);
    return { status: r.status, text };
  } catch (e) { log.push(`\n### ${label}\nERROR ${e.message}`); return { status: 0, text: "" }; }
};

// ---------- A. static.case.law structure ----------
const root = await get("CAP static root", "https://static.case.law/");
log.push("  --- links ---");
const links = [...root.text.matchAll(/href="([^"]+)"/g)].map(m => m[1]).slice(0, 40);
log.push("  " + links.join("\n  "));

const f2d = await get("CAP static /f2d/ (reporter dir)", "https://static.case.law/f2d/");
log.push("  --- subdirs (first 12) ---");
const subs = [...f2d.text.matchAll(/href="([^"]+)\/"/g)].map(m => m[1]).slice(0, 12);
log.push("  " + subs.join("\n  "));
log.push("  --- json/vol files mentioned ---");
const jf = [...f2d.text.matchAll(/href="([^"]*\.(?:json|tar|zip|gz))"/g)].map(m => m[1]).slice(0, 15);
log.push("  " + jf.join("\n  "));

// try a real volume dir + its CasesMetadata
if (subs[0]) {
  const vol = await get(`CAP static /f2d/${subs[0]}/`, `https://static.case.law/f2d/${subs[0]}/`);
  const volfiles = [...vol.text.matchAll(/href="([^"]+)"/g)].map(m => m[1]).slice(0, 25);
  log.push("  --- volume files ---\n  " + volfiles.join("\n  "));
  const cases = await get(`CAP /f2d/${subs[0]}/CasesMetadata.json`, `https://static.case.law/f2d/${subs[0]}/CasesMetadata.json`);
  if (cases.status === 200) {
    try {
      const j = JSON.parse(cases.text);
      log.push("  CASE COUNT: " + j.length);
      log.push("  sample keys: " + Object.keys(j[0]).join(", "));
      log.push("  sample: " + JSON.stringify({ name: j[0].name_abbreviation, cite: j[0].citations, id: j[0].id }));
      log.push("  has 'casebody'? " + ("casebody" in j[0]));
    } catch (e) { log.push("  parse fail: " + e.message); }
  }
}

// ---------- B. CourtListener bulk data S3 ----------
const bulk = await get("CL bulk S3 root", "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/?list-type=2&max-keys=60&delimiter=/");
const keys = [...bulk.text.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
const prefixes = [...bulk.text.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)].map(m => m[1]);
log.push("  --- keys (first 30) ---\n  " + keys.slice(0, 30).join("\n  "));
log.push("  --- prefixes ---\n  " + prefixes.join("\n  "));

// ---------- C. THE critical test: does quote-in-search surface the right case? ----------
// If searching an exact quote returns the case + a snippet containing it, we get quote
// verification WITHOUT full text.
const quotes = [
  { q: "separate educational facilities are inherently unequal", want: "Brown" },
  { q: "the most celebrated and important civil litigation of the century", want: "(unknown)" },
  { q: "plaintiff was injured by the negligence of the defendant", want: "(generic - should be weak)" },
];
for (const { q, want } of quotes) {
  const u = `https://www.courtlistener.com/api/rest/v4/search/?q=${encodeURIComponent('"' + q + '"')}&type=o`;
  const r = await get(`QUOTE SEARCH: "${q.slice(0, 45)}..."  [want: ${want}]`, u);
  try {
    const j = JSON.parse(r.text);
    log.push("  count: " + j.count);
    for (const res of (j.results || []).slice(0, 3)) {
      log.push(`   -> ${res.caseName} | ${res.dateFiled} | ${res.court}`);
      log.push(`      snippet: ${JSON.stringify(String(res.opinions?.[0]?.snippet || res.snippet || "").slice(0, 200))}`);
    }
  } catch { log.push("  non-JSON: " + r.text.slice(0, 120)); }
}

// ---------- D. Cornell LII = free SCOTUS full text, confirm it has the opinion body ----------
const lii = await get("Cornell LII 347/483", "https://www.law.cornell.edu/supremecourt/text/347/483");
const hasBody = /inherently unequal/.test(lii.text);
log.push("  contains \"inherently unequal\": " + hasBody);
const stripped = lii.text.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const idx = stripped.indexOf("inherently unequal");
log.push("  extractable around quote: " + JSON.stringify(stripped.slice(Math.max(0, idx - 200), idx + 120)));
log.push("  visible text length: " + stripped.length);

console.log(log.join("\n"));
