// Phase 1 correctness probe: is an exact `citations[].cite` match UNIQUE within a volume?
//
// A subagent sweep of us/572 reported 803 of 893 distinct cite strings shared by multiple
// records. If true, a lookup that returns the FIRST match silently picks an arbitrary case —
// which is the exact silent misattribution CiteProof exists to catch, committed by our own
// resolver. Measure the structure before designing a tie-break, because the right fix depends
// on WHY the duplicates exist.
//
// Run: node .recon/probe-cite-ambiguity.mjs [reporter] [volume]
const UA = "lexhack-recon/0.1";
const reporter = process.argv[2] ?? "us";
const volume = Number(process.argv[3] ?? 572);

const r = await fetch(`https://static.case.law/${reporter}/${volume}/CasesMetadata.json`, {
  headers: { "User-Agent": UA },
});
if (r.status !== 200) {
  console.log(`metadata HTTP ${r.status} — nothing to measure`);
  process.exit(1);
}
const records = await r.json();

console.log(`### POSITIVE CONTROL — ${reporter}/${volume} records=${records.length}`);
if (records.length < 10) {
  console.log("  *** PROBE BROKEN — implausibly few records, refusing to report. ***");
  process.exit(1);
}
console.log(`  CONTROL PASSED (a volume with ${records.length} records was parsed)`);

// --- 1. cite -> records ----------------------------------------------------
const byCite = new Map();
for (const rec of records) {
  for (const c of rec.citations ?? []) {
    if (!byCite.has(c.cite)) byCite.set(c.cite, []);
    byCite.get(c.cite).push({ type: c.type, id: rec.id, name: rec.name_abbreviation, file: rec.file_name, date: rec.decision_date });
  }
}
const shared = [...byCite.entries()].filter(([, v]) => v.length > 1);
console.log(`\n### 1. Uniqueness of exact cite match`);
console.log(`  distinct cite strings : ${byCite.size}`);
console.log(`  shared by >1 record   : ${shared.length} (${((shared.length / byCite.size) * 100).toFixed(1)}%)`);
console.log(`  max records for 1 cite: ${Math.max(...[...byCite.values()].map((v) => v.length))}`);

// --- 2. WHY are they shared? The fix depends entirely on this. -------------
console.log(`\n### 2. Structure of the collisions (are the records the SAME case?)`);
const worst = [...shared].sort((a, b) => b[1].length - a[1].length).slice(0, 4);
for (const [cite, hits] of worst) {
  const ids = new Set(hits.map((h) => h.id));
  const names = new Set(hits.map((h) => h.name));
  const files = new Set(hits.map((h) => h.file));
  console.log(`  "${cite}" -> ${hits.length} records | distinct ids=${ids.size} names=${names.size} files=${files.size}`);
  for (const h of hits.slice(0, 4)) console.log(`      id=${h.id} type=${JSON.stringify(h.type)} file=${h.file} "${h.name}" ${h.date}`);
}

// --- 3. Which citation TYPE is the unique one? ----------------------------
// If the OFFICIAL cite is unique per case and the shared ones are parallel/vendor cites,
// the fix is a type preference. If everything is shared, the fix has to be different.
console.log(`\n### 3. Uniqueness by citation type`);
const byType = new Map();
for (const [, hits] of byCite) {
  for (const h of hits) {
    const t = h.type ?? "(none)";
    if (!byType.has(t)) byType.set(t, { total: 0, shared: 0 });
    byType.get(t).total++;
  }
}
for (const [cite, hits] of shared) {
  for (const h of hits) {
    const t = h.type ?? "(none)";
    byType.get(t).shared++;
  }
}
for (const [t, s] of [...byType].sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  type=${String(t).padEnd(10)} entries=${String(s.total).padStart(5)}  in-collisions=${String(s.shared).padStart(5)}`);

}

// --- 4. The concrete cases the E6 sweep flagged ----------------------------
console.log(`\n### 4. The flagged E6 candidates — how many records claim their cite?`);
for (const want of ["572 U.S. 1110", "572 U.S. 1003", "572 U.S. 1012", "572 U.S. 1155"]) {
  const hits = byCite.get(want) ?? [];
  const uniq = new Set(hits.map((h) => h.id));
  const fileUniq = new Set(hits.map((h) => h.file));
  console.log(`  "${want}": ${hits.length} matches, ${uniq.size} distinct ids, ${fileUniq.size} distinct files -> ${fileUniq.size === 1 ? "UNIQUE FILE (safe)" : "AMBIGUOUS FILE"}`);
  for (const h of hits.slice(0, 3)) console.log(`      type=${JSON.stringify(h.type)} file=${h.file} ID=${h.id} "${h.name}"`);
}
