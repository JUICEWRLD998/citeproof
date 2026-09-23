// Find a REAL case that quotes Brown's holding verbatim, so the Phase 5 ranker has a genuine
// multi-home fixture instead of a synthetic one. Run: node .recon/find-brow-quoter.mjs
import { readFileSync } from "node:fs";

const UA = "citeproof/0.1 (lexhack; quoter search)";
const HOLDING = "Separate educational facilities are inherently unequal.";

/** Candidate quoting cases, from the CL survey: real cases whose metadata carries these cites. */
const CANDIDATES = [
  { reporter: "us", vol: 570, cite: "570 U.S. 297", label: "Shelby County v. Holder (2013)" },
  { reporter: "f3d", vol: 671, cite: "671 F.3d 611", label: "(7th Cir. 2011)" },
];

for (const c of CANDIDATES) {
  const metaUrl = `https://static.case.law/${c.reporter}/${c.vol}/CasesMetadata.json`;
  const mr = await fetch(metaUrl, { headers: { "User-Agent": UA } });
  if (mr.status !== 200) {
    console.log(`SKIP ${c.label}: metadata HTTP ${mr.status}`);
    continue;
  }
  const meta = await mr.json();
  const rec = meta.find((m) => (m.citations ?? []).some((x) => x.cite === c.cite));
  if (!rec) {
    console.log(`SKIP ${c.label}: no record in ${c.reporter}/${c.vol} carries "${c.cite}"`);
    continue;
  }
  console.log(`FOUND ${c.label} -> file ${rec.file_name} (${rec.name})`);

  const caseUrl = `https://static.case.law/${c.reporter}/${c.vol}/cases/${rec.file_name}.json`;
  const cr = await fetch(caseUrl, { headers: { "User-Agent": UA } });
  if (cr.status !== 200) {
    console.log(`  case body HTTP ${cr.status}`);
    continue;
  }
  const cj = await cr.json();
  const text = (cj.casebody?.opinions ?? []).map((o) => o.text ?? "").join("\n") + "\n" + (cj.casebody?.head_matter ?? "");

  const exact = text.includes(HOLDING);
  const casefolded = text.toLowerCase().includes(HOLDING.toLowerCase());
  console.log(`  chars=${text.length} ocr=${cj.analysis?.ocr_confidence} date=${cj.decision_date}`);
  console.log(`  contains holding EXACT: ${exact}   case-folded: ${casefolded}`);
  if (exact) {
    console.log(`  ★ USABLE as a real quoter fixture. cite=${c.cite} file=${rec.file_name}`);
  }
  await new Promise((r) => setTimeout(r, 200));
}

// Sanity: our own fixture must contain it exactly, or the probe is measuring nothing.
const brown = JSON.parse(readFileSync("fixtures/corpus/us-347-0483-01.json", "utf8"));
console.log(`\ncontrol: Brown fixture contains holding EXACTLY: ${brown.text.includes(HOLDING)}`);
