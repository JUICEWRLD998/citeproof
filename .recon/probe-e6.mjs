// Phase 1 recon (v2): source a genuine `UNVERIFIABLE_UNRESOLVED` fixture (ground-truth E6).
//
// E6 needs a case that is ALL THREE of:
//   (a) genuinely citable  — appears in CasesMetadata.json
//   (b) has no usable opinion text — no casebody / empty opinions / whitespace-only text
//   (c) its citation maps to EXACTLY ONE record in its volume (unique file_name)
//
// (c) is the constraint v1 missed. In `us/572`, 803 of 893 distinct cite strings are shared
// by multiple records, because volumes end with SCOTUS ORDERS LISTS: many short dispositions
// printed on one page, one metadata record each. Exact-cite matching there is 1-to-many, so
// a fixture whose cite cannot single out a record cannot be used.
//
// CORRECTION to v1: v1's final verification looked cases up as `<first_page>-01`, which is
// only correct when a page holds one record. It therefore verified the WRONG records and its
// four "verified" candidates were misidentified. Everything below is keyed by `file_name`
// taken from metadata, which is the only safe key.
//
// Answers three questions:
//   1. does a unique-cite empty-body case exist?
//   2. is cite ambiguity an orders-list artefact, or pervasive?
//   3. across EMPTY-opinion records, what are the raw head_matter lengths?
//
// Run: node .recon/probe-e6.mjs
const UA = "lexhack-recon/0.1";
const BASE = "https://static.case.law";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJson = async (url) => {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.status !== 200) return { status: r.status, json: null };
    const text = await r.text();
    try { return { status: 200, json: JSON.parse(text) }; } catch { return { status: 200, json: null, bad: true }; }
  } catch (e) { return { status: 0, json: null, error: e.message }; }
};

/** The empty-condition, or null when the record HAS usable opinion text. */
function classify(j) {
  if (!j) return "fetch-failed";
  if (!("casebody" in j)) return "no-casebody-key";
  const cb = j.casebody;
  if (cb === null || cb === undefined) return "casebody-null";
  const ops = cb.opinions;
  if (!Array.isArray(ops) || ops.length === 0) return "empty-opinions-array";
  if (ops.every((o) => String(o?.text ?? "").trim().length === 0)) return "whitespace-only-text";
  return null;
}

const lengths = (j) => {
  const cb = (j && j.casebody) || {};
  const ops = Array.isArray(cb.opinions) ? cb.opinions : [];
  return {
    opLen: ops.map((o) => String(o?.text ?? "").length).reduce((a, b) => a + b, 0),
    hmLen: String(cb.head_matter ?? "").trim().length,
    auxLen: ["judges", "parties", "attorneys", "corrections"]
      .map((k) => String(cb[k] ?? "").trim().length)
      .reduce((a, b) => a + b, 0),
  };
};

/** cite -> number of records in this volume carrying it, plus type breakdown. */
function citeIndex(records) {
  const count = new Map();
  const types = new Map();
  for (const r of records) {
    for (const c of r.citations ?? []) {
      if (!c?.cite) continue;
      count.set(c.cite, (count.get(c.cite) ?? 0) + 1);
      if (!types.has(c.cite)) types.set(c.cite, new Set());
      types.get(c.cite).add(c.type ?? "unknown");
    }
  }
  return { count, types };
}

/**
 * Uniqueness profile for one record. `official` is the reporter being digested
 * (type === "official"); everything else is a parallel/vendor cite.
 */
function uniqueness(record, idx) {
  const cites = (record.citations ?? []).filter((c) => c?.cite);
  const official = cites.filter((c) => c.type === "official");
  const parallel = cites.filter((c) => c.type !== "official");
  const one = (arr) => arr.length > 0 && arr.every((c) => idx.count.get(c.cite) === 1);
  return {
    allUnique: cites.length > 0 && cites.every((c) => idx.count.get(c.cite) === 1),
    officialUnique: one(official),
    parallelUnique: one(parallel),
    maxCollision: cites.reduce((m, c) => Math.max(m, idx.count.get(c.cite) ?? 0), 0),
  };
}

const volumeUrl = (rep, vol) => `${BASE}/${rep}/${vol}`;

async function volumeIndex(rep, vol) {
  const { status, json } = await getJson(`${volumeUrl(rep, vol)}/CasesMetadata.json`);
  if (!json) return { status, records: null };
  return { status, records: json, idx: citeIndex(json) };
}

async function lastVolume(rep) {
  const r = await fetch(`${BASE}/${rep}/`, { headers: { "User-Agent": UA } }).catch(() => null);
  if (!r || r.status !== 200) return null;
  const html = await r.text();
  const vols = [...new Set([...html.matchAll(new RegExp(`/${rep}/([0-9]+)/`, "g"))].map((m) => +m[1]))].sort((a, b) => a - b);
  return vols.length ? { max: vols[vols.length - 1], all: vols } : null;
}

// ================================================================ 0. CONTROL
console.log("### 0. PLANTED POSITIVE CONTROL — detector must report TEXT for all three");
const CONTROLS = [
  { reporter: "us", vol: 347, file: "0483-01", name: "Brown v. Board" },
  { reporter: "us", vol: 163, file: "0537-01", name: "Plessy v. Ferguson" },
  { reporter: "us", vol: 477, file: "0242-01", name: "Anderson v. Liberty Lobby" },
];
let controlOk = true;
for (const c of CONTROLS) {
  const { json } = await getJson(`${volumeUrl(c.reporter, c.vol)}/cases/${c.file}.json`);
  const L = lengths(json);
  const pass = classify(json) === null && L.opLen > 2000;
  if (!pass) controlOk = false;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${c.name.padEnd(26)} HTTP${json ? "" : "?"} opinionChars=${L.opLen} head_matter=${L.hmLen} condition=${classify(json)}`);
}
if (!controlOk) {
  console.log("\n*** CONTROL FAILED — detector is blind. Reporting NOTHING. ***");
  process.exit(1);
}
console.log("  CONTROL PASSED\n");

// ================================================ 1. cite-uniqueness by reporter
// Compare the LAST volume against a MIDDLE volume: if ambiguity is an orders-list
// artefact it should be heavy in the last volume and light in the middle one.
console.log("### 1. Cite uniqueness per reporter — last volume vs middle volume");
const REPORTERS = ["us", "f2d", "f-supp-2d", "f3d", "cal-2d"];
const collisionReport = {};

for (const rep of REPORTERS) {
  const lv = await lastVolume(rep);
  if (!lv) { console.log(`  ${rep.padEnd(11)} no volumes enumerated`); continue; }
  const picks = [
    { tag: "last", vol: lv.max },
    { tag: "middle", vol: lv.all[Math.floor(lv.all.length / 2)] },
  ];
  collisionReport[rep] = {};
  for (const p of picks) {
    if (!p.vol) continue;
    const { records, idx } = await volumeIndex(rep, p.vol);
    if (!records) { console.log(`  ${rep.padEnd(11)} ${p.tag} vol ${p.vol}: metadata unavailable`); continue; }
    const distinct = idx.count.size;
    const shared = [...idx.count.values()].filter((n) => n > 1).length;
    const maxShare = Math.max(0, ...idx.count.values());
    const uRecords = records.filter((r) => uniqueness(r, idx).allUnique).length;
    const sharedDist = {};
    for (const n of idx.count.values()) sharedDist[n] = (sharedDist[n] ?? 0) + 1;
    collisionReport[rep][p.tag] = { vol: p.vol, records: records.length, distinct, shared, maxShare, uniqueCiteRecords: uRecords };
    console.log(
      `  ${rep.padEnd(11)} ${p.tag.padEnd(6)} vol ${String(p.vol).padStart(4)}  records=${String(records.length).padStart(5)}  distinctCites=${String(distinct).padStart(5)}  SHARED=${String(shared).padStart(5)} (${((shared / distinct) * 100).toFixed(1)}%)  maxShare=${String(maxShare).padStart(2)}  recordsWithAllUniqCites=${uRecords}`,
    );
    await sleep(150);
  }
}

// ======================== 2. unique-cite AND empty-body: the actual E6 target
console.log("\n### 2. Search for a UNIQUE-CITE record with NO usable opinion text");
const targetVolumes = [
  ["us", 572], ["us", 570], ["us", 566], ["us", 540], ["us", 520],
  ["f2d", 999], ["f2d", 500], ["f-supp-2d", 999], ["f-supp-2d", 500],
  ["f3d", 935], ["f3d", 500], ["f-supp-3d", 392], ["f-appx", 714], ["cal-2d", 71],
];
const uniqueEmpty = [];
const emptyAny = [];
const headMatterRows = [];
let classified = 0;

for (const [rep, vol] of targetVolumes) {
  const { records, idx } = await volumeIndex(rep, vol);
  if (!records) { console.log(`  ${rep}/${vol}: metadata unavailable`); continue; }

  // Classify (a) every record whose cites are ALL unique, and (b) a spread of others
  // so the head_matter distribution is not biased toward unique-cite records only.
  const allUniq = records.filter((r) => uniqueness(r, idx).allUnique);
  const step = Math.max(1, Math.floor(records.length / 30));
  const spread = records.filter((_, i) => i % step === 0).slice(0, 30);
  const targets = [...new Map([...allUniq, ...spread].map((r) => [r.file_name, r])).values()].slice(0, 55);

  let volEmpty = 0;
  let volEmptyUnique = 0;
  for (const rec of targets) {
    const { json } = await getJson(`${volumeUrl(rep, vol)}/cases/${rec.file_name}.json`);
    await sleep(140);
    if (!json) continue;
    classified++;
    const cond = classify(json);
    if (cond === null) continue;
    const L = lengths(json);
    const u = uniqueness(rec, idx);
    const official = (rec.citations ?? []).find((c) => c.type === "official")?.cite ?? (rec.citations ?? [])[0]?.cite;
    volEmpty++;
    const row = {
      reporter: rep, volume: vol, fileName: rec.file_name, official, date: rec.decision_date,
      name: rec.name_abbreviation ?? rec.name, condition: cond,
      hmLen: L.hmLen, auxLen: L.auxLen, allUnique: u.allUnique, maxCollision: u.maxCollision,
      url: `${volumeUrl(rep, vol)}/cases/${rec.file_name}.json`,
    };
    emptyAny.push(row);
    headMatterRows.push(row);
    if (u.allUnique) { uniqueEmpty.push(row); volEmptyUnique++; }
  }
  console.log(
    `  ${rep}/${String(vol).padStart(4)} classified=${String(targets.length).padStart(3)}  emptyBody=${String(volEmpty).padStart(3)}  ofWhichAllCitesUnique=${volEmptyUnique}`,
  );
}

console.log(`\n  TOTAL classified=${classified}  emptyBody=${emptyAny.length}  UNIQUE-CITE emptyBody=${uniqueEmpty.length}`);
console.log(`\n  Collision by condition (condition -> count -> allUnique|shared):`);
const byCond = {};
for (const r of emptyAny) {
  byCond[r.condition] ??= { total: 0, unique: 0 };
  byCond[r.condition].total++;
  if (r.allUnique) byCond[r.condition].unique++;
}
for (const [k, v] of Object.entries(byCond)) console.log(`    ${k.padEnd(24)} total=${String(v.total).padStart(3)}  allCitesUnique=${v.unique}`);

if (uniqueEmpty.length) {
  console.log("\n  *** UNIQUE-CITE EMPTY-BODY CANDIDATES ***");
  for (const r of uniqueEmpty.sort((a, b) => a.hmLen - b.hmLen)) {
    console.log(`    ${String(r.official).padEnd(18)} ${String(r.name).slice(0, 34).padEnd(36)} [${r.condition}] hm=${r.hmLen} aux=${r.auxLen} date=${r.date}`);
    console.log(`      ${r.url}`);
  }
} else {
  console.log("\n  NONE FOUND — no empty-body record in the sweep has an all-unique citation set.");
}

// ==================================== 3. head_matter length distribution (RAW)
console.log("\n### 3. head_matter lengths of EMPTY-opinion records (raw, ascending — no threshold chosen)");
const sorted = [...headMatterRows].sort((a, b) => a.hmLen - b.hmLen);
console.log(`  n=${sorted.length}`);
console.log(`  raw lengths: ${JSON.stringify(sorted.map((r) => r.hmLen))}`);
if (sorted.length) {
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].hmLen;
  console.log(`  min=${sorted[0].hmLen} p25=${q(0.25)} median=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)} max=${sorted[sorted.length - 1].hmLen}`);
}
console.log("  detail (smallest 12 / largest 6):");
for (const r of [...sorted.slice(0, 12), ...sorted.slice(-6)]) {
  console.log(`    hm=${String(r.hmLen).padStart(6)}  aux=${String(r.auxLen).padStart(5)}  ${r.reporter}/${r.volume} ${String(r.fileName).padEnd(9)} ${String(r.official).padEnd(18)} ${String(r.name ?? "").slice(0, 30)}`);
}
