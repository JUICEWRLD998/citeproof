// Verify EVERY quote + offset before it is baked into fixtures/ground-truth.json.
// Discipline: a ground truth I have not verified is an invented fact.
// Run: node .recon/probe-fixtures.mjs

const UA = "lexhack-recon/0.1";
const log = [];
const gj = async (u) => {
  const r = await fetch(u, { headers: { "User-Agent": UA } });
  if (r.status !== 200) return { s: r.status };
  try { return { s: 200, j: await r.json() }; } catch { return { s: r.status }; }
};
const textOf = (c) =>
  (c.casebody?.opinions || []).map((o) => o.text).join("\n") + "\n" + (c.casebody?.head_matter || "");

async function load(rep, vol, file) {
  const m = await gj(`https://static.case.law/${rep}/${vol}/CasesMetadata.json`);
  if (!m.j) return { err: `metadata HTTP ${m.s}` };
  const meta = m.j.find((c) => c.file_name === file);
  if (!meta) return { err: `file_name ${file} not in ${rep}/${vol}` };
  const c = await gj(`https://static.case.law/${rep}/${vol}/cases/${file}.json`);
  if (!c.j) return { err: `case HTTP ${c.s}` };
  return { meta, case: c.j, text: textOf(c.j) };
}

function check(label, text, quote) {
  const i = text.indexOf(quote);
  log.push(`  ${i >= 0 ? "FOUND @ " + i : "ABSENT     "}  ${label}`);
  if (i >= 0) log.push(`     len=${quote.length}  end=${i + quote.length}`);
  return i;
}

// ---------------- Brown ----------------
const brown = await load("us", 347, "0483-01");
log.push("### BROWN (us/347/0483-01)");
log.push(`  ocr=${brown.meta?.analysis?.ocr_confidence}  chars=${brown.meta?.analysis?.char_count}  textLen=${brown.text?.length}`);
log.push(`  citations: ${brown.meta?.citations.map((c) => c.cite).join(" | ")}`);
log.push("  -- quote checks (raw, as it appears) --");
const bQuotes = {
  "line1 holding": "Separate educational facilities are inherently unequal.",
  "line1 holding (no period)": "Separate educational facilities are inherently unequal",
};
for (const [k, q] of Object.entries(bQuotes)) check(k, brown.text, q);

// ---------------- Plessy ----------------
const plessy = await load("us", 163, "0537-01");
log.push("\n### PLESSY (us/163/0537-01)");
log.push(`  ocr=${plessy.meta?.analysis?.ocr_confidence}  chars=${plessy.meta?.analysis?.char_count}  textLen=${plessy.text?.length}`);
log.push(`  citations: ${plessy.meta?.citations.map((c) => c.cite).join(" | ")}`);
log.push(`  opinions: ${plessy.case.casebody.opinions.length} -> ${plessy.case.casebody.opinions.map((o) => o.type).join(", ")}`);
log.push("  -- is Brown's holding in Plessy? (must be ABSENT for the misattribution fixture) --");
check("Brown holding in Plessy", plessy.text, "Separate educational facilities are inherently unequal");

log.push("  -- is the drafted Fourteenth-Amendment sentence real? --");
check("14th Amdt drafted sentence", plessy.text,
  "the Fourteenth Amendment is not confined to the correction of legislation that operates directly upon the colored race alone");
check("14th Amdt (loose)", plessy.text, "not confined to the correction of legislation");

log.push("  -- candidate REAL Plessy sentences available for fixtures --");
const candidate = "Our constitution is color-blind, and neither knows nor tolerates classes among citizens.";
check("Harlan color-blind", plessy.text, candidate);
const i2 = plessy.text.indexOf("color-blind");
if (i2 >= 0) log.push("     ctx: " + JSON.stringify(plessy.text.slice(Math.max(0, i2 - 120), i2 + 160)));

// ---------------- Anderson v. Liberty Lobby ----------------
log.push("\n### ANDERSON v. LIBERTY LOBBY (477 U.S. 242) — real case behind a FAKE citation");
const and = await load("us", 477, "0242-01");
if (and.err) log.push("  " + and.err);
else {
  log.push(`  ocr=${and.meta?.analysis?.ocr_confidence}  textLen=${and.text?.length}`);
  log.push(`  name: ${and.meta.name}`);
  check("summary-judgment quote", and.text,
    "no reasonable jury could return a verdict for the nonmoving party");
}

// ---------------- Boundary cases ----------------
log.push("\n### BOUNDARY CASES (must NOT resolve)");
const fake = await gj("https://static.case.law/us/999/CasesMetadata.json");
log.push(`  999 U.S. 1234 -> us/999 metadata: HTTP ${fake.s}  ${fake.s !== 200 ? "(correctly absent -> FABRICATED)" : "*** UNEXPECTED ***"}`);
const m3d = await gj("https://static.case.law/f-supp-3d/678/CasesMetadata.json");
log.push(`  678 F. Supp. 3d 443 -> f-supp-3d/678 metadata: HTTP ${m3d.s}  ${m3d.s !== 200 ? "(correctly absent -> passed boundary -> COVERAGE)" : "*** UNEXPECTED ***"}`);

console.log(log.join("\n"));
