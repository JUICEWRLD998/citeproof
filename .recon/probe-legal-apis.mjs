// Recon probe: which free legal-primary-source APIs actually work with NO credential?
// Run: node .recon/probe-legal-apis.mjs

const UA = "lexhack-recon/0.1 (research; contact: participant)";
const out = [];
const log = (...a) => { out.push(a.join(" ")); };

async function j(label, url, opts = {}) {
  try {
    const t0 = Date.now();
    const r = await fetch(url, {
      ...opts,
      headers: { "User-Agent": UA, Accept: "application/json", ...(opts.headers || {}) },
    });
    const ms = Date.now() - t0;
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    log(`\n### ${label}\nHTTP ${r.status}  (${ms}ms)  ${url}`);
    const rl = {};
    for (const [k, v] of r.headers) if (/throttle|ratelimit|retry-after/i.test(k)) rl[k] = v;
    if (Object.keys(rl).length) log("  headers:", JSON.stringify(rl));
    return { status: r.status, body };
  } catch (e) {
    log(`\n### ${label}\nERROR ${e.message}  ${url}`);
    return { status: 0, body: null };
  }
}

// ---- A. CourtListener v4 search, case-name query: does it carry opinion text snippets?
const A = await j("CL v4 search — case name", "https://www.courtlistener.com/api/rest/v4/search/?q=%22Brown+v.+Board+of+Education%22&type=o");
if (A.body?.count !== undefined) {
  log("  count:", A.body.count);
  const r0 = A.body.results?.[0];
  if (r0) {
    log("  result keys:", Object.keys(r0).join(", "));
    log("  caseName:", r0.caseName);
    log("  citation:", JSON.stringify(r0.citation));
    log("  dateFiled:", r0.dateFiled, "| court:", r0.court);
    log("  snippet:", JSON.stringify(String(r0.snippet || "").slice(0, 220)));
    log("  opinions[0] keys:", Object.keys(r0.opinions?.[0] || {}).join(", "));
    log("  opinions[0].snippet:", JSON.stringify(String(r0.opinions?.[0]?.snippet || "").slice(0, 220)));
  }
}

// ---- B. CourtListener v4 search, reporter-citation query: can we go citation -> case?
const B = await j("CL v4 search — reporter cite", 'https://www.courtlistener.com/api/rest/v4/search/?q=%22347+U.S.+483%22&type=o');
if (B.body?.count !== undefined) {
  log("  count:", B.body.count);
  log("  top:", B.body.results?.[0]?.caseName, "|", JSON.stringify(B.body.results?.[0]?.citation));
}

// ---- C. CourtListener v3 search (legacy, sometimes broader anonymous access)
const C = await j("CL v3 search", 'https://www.courtlistener.com/api/rest/v3/search/?q=%22Brown+v.+Board%22&type=o');
log("  count:", C.body?.count);

// ---- D. CourtListener citation-lookup (the endpoint we WANT) — confirm auth requirement
const D = await j("CL v4 citation-lookup (no creds)", "https://www.courtlistener.com/api/rest/v4/citation-lookup/", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "Brown v. Board of Education, 347 U.S. 483 (1954)." }),
});
log("  detail:", D.body?.detail);

// ---- E. Does a bare opinion detail page work anonymously? (we need FULL TEXT for quote-checking)
const E = await j("CL v4 opinions detail (no creds)", "https://www.courtlistener.com/api/rest/v4/opinions/7311817/");
log("  detail:", E.body?.detail);

// ---- F. CourtListener public HTML opinion page (scrape path, no key at all)
const F = await j("CL public HTML opinion page", "https://www.courtlistener.com/opinion/7311817/brown-v-board-of-education/");
if (typeof F.body === "string") log("  first 200:", JSON.stringify(F.body.slice(0, 200)));

// ---- G. CAP / case.law (Harvard Caselaw Access Project) — free token API
const G = await j("CAP case.law cites lookup (no creds)", "https://api.case.law/v1/cases/?cite=347%20U.S.%20483");
log("  body:", JSON.stringify(G.body).slice(0, 300));

// ---- H. GovInfo (US GPO) — free key required
const H = await j("GovInfo search (no key)", "https://api.govinfo.gov/search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "test", pageSize: 1 }),
});
log("  body:", JSON.stringify(H.body).slice(0, 250));

// ---- I. Anonymous rate-limit shape: 6 rapid CL search calls
const codes = [];
for (let i = 0; i < 6; i++) {
  const r = await fetch("https://www.courtlistener.com/api/rest/v4/search/?q=contract&type=o", {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  codes.push(r.status);
  if (r.status === 429) { log("\n### I. rate limit hit on call", i + 1, "retry-after:", r.headers.get("retry-after")); break; }
}
log("\n### I. CL anon rapid-fire status codes:", codes.join(","));

console.log(out.join("\n"));
