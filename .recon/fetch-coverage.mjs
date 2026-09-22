// Derive fixtures/coverage.json (the table lib/corpus/coverage.ts reads at runtime) from the
// MEASURED probe output. Nothing here is hand-written: if a number below is wrong, the fix
// is to re-run .recon/probe-slugs.mjs, not to edit the fixture.
//
// Run: node .recon/fetch-coverage.mjs   (after node .recon/probe-slugs.mjs)
import { readFileSync, writeFileSync } from "node:fs";

const measured = JSON.parse(readFileSync(".recon/coverage-measured.json", "utf8"));

if (!measured.measured || !Object.keys(measured.measured).length) {
  console.error("coverage-measured.json carries no measurements — run probe-slugs.mjs first. Writing nothing.");
  process.exit(1);
}

const reporters = {};
let skipped = 0;
for (const [slug, m] of Object.entries(measured.measured)) {
  // A reporter with no measured boundary date cannot drive the date rule. Carrying it would
  // make the coverage check silently pass for that reporter, which is the failure mode this
  // whole layer exists to prevent. Record only what was actually measured.
  if (!m.latestDecisionDate || m.maxVolume == null) { skipped++; continue; }
  reporters[slug] = {
    volumes: m.volumes,
    maxVolume: m.maxVolume,
    latestDecisionDate: m.latestDecisionDate,
    maxPageObserved: m.maxPageObserved ?? null,
  };
}

const out = {
  $provenance: {
    source: "https://static.case.law/ reporter index + per-volume CasesMetadata.json",
    measuredBy: ".recon/probe-slugs.mjs",
    measuredAt: measured.$provenance?.probedAt ?? null,
    reportersEnumerated: measured.allReporterDirs?.length ?? 0,
    note: "MEASURED, not assumed. Regenerate with probe-slugs.mjs then this script. lib/corpus/coverage.ts is the only reader.",
  },
  reporters,
};

writeFileSync("fixtures/coverage.json", JSON.stringify(out, null, 2));

const table = Object.entries(reporters)
  .map(([s, r]) => `  ${s.padEnd(12)} maxVol=${String(r.maxVolume).padStart(4)}  latest=${r.latestDecisionDate}  maxPage=${r.maxPageObserved}`)
  .join("\n");
console.log(`wrote fixtures/coverage.json — ${Object.keys(reporters).length} reporters (${skipped} skipped: no measured boundary)\n${table}`);
