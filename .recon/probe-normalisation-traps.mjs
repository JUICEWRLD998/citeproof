// Phase 2 recon: ground EVERY normalisation trap in raw corpus bytes before writing a rule.
//
// The plan's Phase 2 acceptance names four traps, one of which (`“s finding` -> `His finding`)
// rests on a claim that was RETRACTED: the corpus reads "this finding is amply supported by
// modern authority", clean, and the `"s finding` fragment was our own console truncation. A
// repair rule built on it would mangle correct text. So this probe checks the raw bytes.
//
// Run: node .recon/probe-normalisation-traps.mjs
import { readFileSync, readdirSync } from "node:fs";

const DIR = "fixtures/corpus";
const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json");

const texts = [];
for (const f of files) {
  const rec = JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"));
  texts.push({ file: f, text: rec.text ?? "" });
}

console.log("### 0. POSITIVE CONTROL");
const control = texts.find((t) => t.file.includes("347-0483"));
if (!control || control.text.length < 20000) {
  console.log("  *** PROBE BROKEN — Brown fixture missing or short. Reporting nothing. ***");
  process.exit(1);
}
console.log(`  CONTROL PASSED — ${files.length} fixtures, Brown ${control.text.length} chars`);

// --- 1. The RETRACTED trap: is there any `“s ` / `"s ` fragmentation? ---------
console.log("\n### 1. The retracted OCR trap — does a dangling quote+s exist in the RAW bytes?");
const dangling = [];
for (const { file, text } of texts) {
  for (const m of text.matchAll(/(.)“s\s/g)) {
    // Capture the char immediately BEFORE the curly quote. If the corpus were genuinely
    // damaged we would expect "thi" + dangling; if clean we expect the fragment not to occur,
    // or to occur as a legitimate possessive.
    dangling.push({ file, before: m[1], idx: m.index, ctx: text.slice(Math.max(0, m.index - 30), m.index + 20) });
  }
  for (const m of text.matchAll(/(\w+)s finding/g)) {
    void m;
  }
}
console.log(`  occurrences of <char>“s : ${dangling.length}`);
for (const d of dangling.slice(0, 5)) console.log(`    ${d.file} idx=${d.idx} before=${JSON.stringify(d.before)} ${JSON.stringify(d.ctx)}`);

// The specific sentence the retraction is about.
console.log("\n### 1b. The exact sentence from the retraction note");
for (const { file, text } of texts) {
  const i = text.indexOf("this finding is amply supported");
  if (i >= 0) {
    console.log(`  FOUND CLEAN in ${file} at ${i}: ${JSON.stringify(text.slice(i - 40, i + 60))}`);
  }
}
const anyHisFinding = texts.some((t) => /His finding|his finding/.test(t.text));
console.log(`  "his finding" present anywhere: ${anyHisFinding}`);

// --- 2. Curly quotes: which characters actually appear? ---------------------
console.log("\n### 2. Typographic characters actually present (raw counts)");
const chars = { "“": "U+201C LEFT DOUBLE", "”": "U+201D RIGHT DOUBLE", "‘": "U+2018 LEFT SINGLE", "’": "U+2019 RIGHT SINGLE", "—": "U+2014 EM DASH", "–": "U+2013 EN DASH", " ": "U+00A0 NBSP", "­": "U+00AD SOFT HYPHEN" };
for (const [c, label] of Object.entries(chars)) {
  const total = texts.reduce((n, t) => n + (t.text.split(c).length - 1), 0);
  console.log(`  ${label.padEnd(18)} ${String(total).padStart(6)}`);
}

// --- 3. Line-break hyphenation: does it occur at all? -----------------------
console.log("\n### 3. Line-break hyphenation (the plan calls this trap 'DEFENSIVE')");
let hyphenCount = 0;
for (const { file, text } of texts) {
  const hits = [...text.matchAll(/([a-z]{2,})-\n([a-z]{2,})/g)];
  if (hits.length) {
    console.log(`  ${file}: ${hits.length} occurrences, e.g. ${hits.slice(0, 4).map((m) => `${m[1]}-/${m[2]}`).join("  ")}`);
  }
  hyphenCount += hits.length;
}
console.log(`  total across fixtures: ${hyphenCount}  -> ${hyphenCount > 0 ? "REAL, not defensive" : "not observed (plan's 'DEFENSIVE' label stands)"}`);

// --- 4. Case-sensitivity trap (known real) ---------------------------------
console.log("\n### 4. The capitalisation trap (already confirmed, re-measured here)");
const brown = texts.find((t) => t.file.includes("347-0483")).text;
console.log(`  "Separate educational..." -> ${brown.indexOf("Separate educational facilities are inherently unequal")}`);
console.log(`  "separate educational..." -> ${brown.indexOf("separate educational facilities are inherently unequal")}`);

// --- 5. Soft hyphen / nbsp adjacency, which breaks naive whitespace collapse -
console.log("\n### 5. Whitespace oddities that a naive collapse can get wrong");
for (const { file, text } of texts) {
  const tabs = (text.match(/\t/g) || []).length;
  const crlf = (text.match(/\r\n/g) || []).length;
  const tripleNl = (text.match(/\n{3,}/g) || []).length;
  console.log(`  ${file.padEnd(28)} tabs=${tabs} crlf=${crlf} runs-of-3+-newlines=${tripleNl}`);
}
