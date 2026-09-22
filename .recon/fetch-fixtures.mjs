// Fetch the two corpus fixtures the test suite reads, so `npm test` is deterministic
// and works offline. Phase 1 generalises this into lib/corpus + a sha256 cache.
// Run: node .recon/fetch-fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const UA = "lexhack-recon/0.1";
const OUT = "fixtures/corpus";
mkdirSync(OUT, { recursive: true });

const targets = [
  { reporter: "us", vol: 347, file: "0483-01", name: "Brown v. Board of Education", out: "us-347-0483-01.json" },
  { reporter: "us", vol: 163, file: "0537-01", name: "Plessy v. Ferguson", out: "us-163-0537-01.json" },
  { reporter: "us", vol: 477, file: "0242-01", name: "Anderson v. Liberty Lobby", out: "us-477-0242-01.json" },
];

for (const t of targets) {
  const url = `https://static.case.law/${t.reporter}/${t.vol}/cases/${t.file}.json`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (r.status !== 200) { console.log(`FAIL ${t.name}: HTTP ${r.status}`); continue; }
  const j = await r.json();
  const text = (j.casebody?.opinions || []).map((o) => o.text).join("\n") + "\n" + (j.casebody?.head_matter || "");

  const record = {
    $provenance: {
      source: url,
      fetchedAt: new Date().toISOString().slice(0, 10),
      note: "Verbatim corpus copy, cached so the test suite is offline and deterministic. Do not hand-edit.",
    },
    citation: j.citations?.[0]?.cite,
    caseName: j.name_abbreviation,
    caseNameFull: j.name,
    decisionDate: j.decision_date,
    court: j.court?.name_abbreviation,
    allCitations: (j.citations || []).map((c) => c.cite),
    sha256: j.analysis?.sha256,
    ocrConfidence: j.analysis?.ocr_confidence,
    charCount: j.analysis?.char_count,
    wordCount: j.analysis?.word_count,
    simhash: j.analysis?.simhash,
    opinionTypes: (j.casebody?.opinions || []).map((o) => o.type),
    text,
  };

  writeFileSync(`${OUT}/${t.out}`, JSON.stringify(record, null, 2));
  console.log(
    `OK   ${t.out.padEnd(26)} ${String(text.length).padStart(6)} chars  ocr=${record.ocrConfidence}  ${record.citation}`,
  );
}
