// Probe 2: can we obtain FULL OPINION TEXT with no credential?
// This decides the architecture. Run: node .recon/probe-fulltext.mjs

const UA = "lexhack-recon/0.1 (research)";
const log = [];

const get = async (label, url, opts = {}) => {
  try {
    const r = await fetch(url, { ...opts, headers: { "User-Agent": UA, ...(opts.headers || {}) } });
    const text = await r.text();
    log.push(`\n### ${label}\nHTTP ${r.status}  len=${text.length}  ${url}`);
    log.push("  ctype: " + r.headers.get("content-type"));
    return { status: r.status, text, headers: r.headers };
  } catch (e) {
    log.push(`\n### ${label}\nERROR ${e.message}`);
    return { status: 0, text: "" };
  }
};

// 1) What does a CL search result's download_url point at, and does it fetch?
const s = await fetch("https://www.courtlistener.com/api/rest/v4/search/?q=%22Brown+v.+Board+of+Education%22&type=o&filed_after=1954-01-01&filed_before=1955-12-31", {
  headers: { "User-Agent": UA },
});
const sj = await s.json();
log.push(`\n### CL search filtered to 1954-1955 SCOTUS-era`);
log.push("  count: " + sj.count);
const first = sj.results?.[0];
log.push("  top: " + first?.caseName + " | " + JSON.stringify(first?.citation) + " | " + first?.dateFiled + " | " + first?.court);
log.push("  download_url: " + first?.opinions?.[0]?.download_url);
log.push("  cluster_id: " + first?.cluster_id + "  opinion_id: " + first?.opinions?.[0]?.id);

// 2) Try that download_url anonymously
if (first?.opinions?.[0]?.download_url) {
  const d = await get("CL opinion download_url (anon)", first.opinions[0].download_url);
  log.push("  first 300: " + JSON.stringify(d.text.slice(0, 300)));
}

// 3) CL public per-opinion HTML/text endpoints, various shapes
await get("CL /opinion/<id>/ (anon)   ", `https://www.courtlistener.com/opinion/${first?.opinions?.[0]?.id}/`);
await get("CL /api/rest/v4/clusters/<id>/opinions/ (anon)", `https://www.courtlistener.com/api/rest/v4/clusters/${first?.cluster_id}/opinions/`);

// 4) Caselaw Access Project — BULK static data (no key, this is the real free corpus)
await get("CAP static root", "https://static.case.law/");
await get("CAP static reporter index", "https://static.case.law/f2d/");
await get("CAP static a reporter's CasesMetadata sample", "https://static.case.law/f2d/CasesMetadata.json");

// 5) Free full-text mirrors of SCOTUS opinions
await get("Cornell LII SCOTUS", "https://www.law.cornell.edu/supremecourt/text/347/483");
await get("Justia SCOTUS", "https://supreme.justia.com/cases/federal/us/347/483/");
await get("OpenJurist", "https://openjurist.org/347/us/483");
await get("law.justia.com", "https://law.justia.com/cases/federal/appellate-courts/F2/240/1/");

// 6) CAP API with the correct v1 shape (no key)
await get("CAP api v1 cases", "https://api.case.law/v1/cases/?cite=347+U.S.+483&full_case=true", { headers: { Accept: "application/json" } });

// 7) OpenAlex-style: is there any truly open full-text legal search?
await get("CourtListener bulk data listing", "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/?list-type=2&max-keys=20");

console.log(log.join("\n"));
