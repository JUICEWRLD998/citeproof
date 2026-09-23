// Add a REAL case that QUOTES Brown's holding verbatim, so the Phase 5 ranker has a genuine
// multi-home fixture instead of a synthetic one.
//
// WHY THIS IS A SEPARATE SCRIPT, and not another entry in fetch-fixtures.mjs.
// `fixtures/ground-truth.json` records `foundAtCharOffset: 9564` for Brown's holding, measured
// against Brown's exact bytes. Re-running the original generator rewrites all three frozen
// fixtures from the network; if the corpus ever re-normalised (or the fetch returned a slightly
// different assembly) that frozen offset would move and every span the UI deep-links to would be
// wrong. So the three are frozen and this script ADDS a fourth, idempotently, touching no
// existing file except index.json.
//
// WHY THIS FIXTURE. `.recon/probe-misattribution.mjs` measured that CourtListener reports **123
// cases** containing that sentence — so a quotation genuinely has many homes in a real corpus, and
// a resolver that takes the first match names a case that merely QUOTES the line. Before this
// fixture the local corpus held exactly ONE case containing it, which meant ranking could not be
// tested against reality at all. McCauley v. City of Chicago (7th Cir. 2011) is a real quoter,
// verified to contain the holding byte-for-byte.
//
// Run: node .recon/add-quoter-fixture.mjs
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const UA = "citeproof/0.1 (lexhack; quoter fixture)";
const OUT = "fixtures/corpus";
const INDEX = `${OUT}/index.json`;

const TARGET = {
  reporter: "f3d",
  vol: 671,
  file: "0611-01",
  expectedCitation: "671 F.3d 611",
  out: "f3d-671-0611-01.json",
};

/** The sentence the ground truth says was misattributed to Plessy. Must be present verbatim. */
const HOLDING = JSON.parse(readFileSync("fixtures/ground-truth.json", "utf8")).expectations[0].quote;

mkdirSync(OUT, { recursive: true });

const url = `https://static.case.law/${TARGET.reporter}/${TARGET.vol}/cases/${TARGET.file}.json`;
const r = await fetch(url, { headers: { "User-Agent": UA } });
if (r.status !== 200) {
  console.error(`FAIL: HTTP ${r.status} for ${url}`);
  process.exit(1);
}
const j = await r.json();

const citation = j.citations?.find((c) => c.type === "official")?.cite ?? j.citations?.[0]?.cite;
const text =
  (j.casebody?.opinions ?? []).map((o) => o.text ?? "").join("\n") +
  "\n" +
  (j.casebody?.head_matter ?? "");

// The fixture is only useful if it genuinely quotes the holding. A fixture that does not would
// make the ranker test pass for the wrong reason — the exact trap this project keeps hitting.
if (!text.includes(HOLDING)) {
  console.error(`FAIL: ${citation} does not contain the holding verbatim; refusing to write it.`);
  process.exit(1);
}
if (citation !== TARGET.expectedCitation) {
  console.error(`FAIL: expected "${TARGET.expectedCitation}", corpus reports "${citation}"`);
  process.exit(1);
}

const record = {
  $provenance: {
    source: url,
    fetchedAt: new Date().toISOString().slice(0, 10),
    note:
      "REAL CASE THAT QUOTES 347 U.S. 483 VERBATIM. Added in Phase 5 so the misattribution ranker " +
      "has a genuine second home to choose against: probe-misattribution.mjs measured 123 cases " +
      "containing that sentence, so 'found it elsewhere' needs ranking to mean anything. " +
      "Verbatim corpus copy; do not hand-edit. Regenerate with .recon/add-quoter-fixture.mjs.",
  },
  citation,
  caseName: j.name_abbreviation,
  caseNameFull: j.name,
  decisionDate: j.decision_date,
  court: j.court?.name_abbreviation,
  allCitations: (j.citations ?? []).map((c) => c.cite),
  sha256: j.analysis?.sha256,
  ocrConfidence: j.analysis?.ocr_confidence,
  charCount: j.analysis?.char_count,
  wordCount: j.analysis?.word_count,
  simhash: j.analysis?.simhash,
  opinionTypes: (j.casebody?.opinions ?? []).map((o) => o.type),
  text,
};

writeFileSync(`${OUT}/${TARGET.out}`, JSON.stringify(record, null, 2));

const index = JSON.parse(readFileSync(INDEX, "utf8"));
const entry = {
  citation,
  reporter: TARGET.reporter,
  volume: TARGET.vol,
  caseFile: TARGET.file,
  caseName: j.name_abbreviation,
  allCitations: record.allCitations,
};
const existing = index.cases.findIndex((c) => c.citation === citation);
if (existing >= 0) index.cases[existing] = entry;
else index.cases.push(entry);
writeFileSync(INDEX, JSON.stringify(index, null, 2) + "\n");

console.log(`wrote ${TARGET.out}`);
console.log(`  citation  ${citation}`);
console.log(`  name      ${j.name_abbreviation}`);
console.log(`  date      ${j.decision_date}  ← later than 1954, so the ranker must not choose it`);
console.log(`  chars     ${text.length}  ocr ${j.analysis?.ocr_confidence ?? "n/a"}`);
console.log(`  holds the sentence verbatim: ${text.includes(HOLDING)}`);
console.log(`  index now has ${index.cases.length} cases`);
console.log(`  existsSync check: ${existsSync(`${OUT}/${TARGET.out}`)}`);
