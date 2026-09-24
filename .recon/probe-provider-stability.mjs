/**
 * probe-provider-stability.mjs — is the seed guarantee real, or provider luck?
 *
 * The first probe (probe-seed-determinism.mjs) showed two identical requests returning
 * byte-identical output. Both were served by **Google**, which is exactly the confound:
 * OpenRouter load-balances across providers, and `seed` is a per-provider parameter. Two
 * identical answers from the same provider prove the seed is honoured THERE; they do not
 * prove a third request reaching a different provider would agree.
 *
 * "Identical seed ⇒ identical output" is an acceptance criterion, and it is a demo claim, so
 * the difference between "measured" and "measured on one provider by luck" matters. This
 * runs the same request N times and records which provider served each, then tests whether
 * the provider can be PINNED — because if it can, determinism stops being luck.
 *
 * Run: node .recon/probe-provider-stability.mjs
 */

import { readFileSync } from "node:fs";

const ENV = readFileSync(".env", "utf8");
const fromFile = Object.fromEntries(
  ENV.split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const KEY = process.env.OPENROUTER_API_KEY || fromFile.OPENROUTER_API_KEY || "";
const MODEL = process.env.OPENROUTER_MODEL || fromFile.OPENROUTER_MODEL || "google/gemini-2.5-flash";
const SEED = 20260922;
const URL = "https://openrouter.ai/api/v1/chat/completions";
const N = Number(process.env.N || 5);

if (!KEY) {
  console.error("no key");
  process.exit(1);
}

const opinion = JSON.parse(readFileSync("fixtures/corpus/us-347-0483-01.json", "utf8")).text;
const PROP = "Racial segregation in public education violates the Equal Protection Clause.";

function body(extra = {}) {
  return {
    model: MODEL,
    temperature: 0,
    seed: SEED,
    ...extra,
    messages: [
      { role: "system", content: "Copy text character-for-character. Never paraphrase." },
      { role: "user", content: `OPINION:\n${opinion}\n\nPROPOSITION:\n${PROP}\n\nReturn the single supporting sentence, copied exactly.` },
    ],
  };
}

async function one(extra, label) {
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body(extra)),
    });
    const text = await res.text();
    if (res.status !== 200) return { label, status: res.status, error: text.slice(0, 220) };
    const j = JSON.parse(text);
    return {
      label,
      status: 200,
      provider: j.provider ?? "(none)",
      content: (j.choices?.[0]?.message?.content ?? "").trim(),
      cost: j.usage?.cost,
    };
  } catch (e) {
    return { label, status: "throw", error: String(e).slice(0, 220) };
  }
}

console.log(`=== A. ${N} identical requests: does the PROVIDER stay stable? ===`);
const runs = [];
for (let i = 1; i <= N; i++) {
  const r = await one({}, `run${i}`);
  runs.push(r);
  if (r.status !== 200) {
    console.log(`  run${i}: FAILED status=${r.status} ${r.error}`);
  } else {
    console.log(`  run${i}: provider=${r.provider}  out=${JSON.stringify(r.content.slice(0, 60))}${r.content.length > 60 ? "…" : ""}`);
  }
  if (i < N) await new Promise((r) => setTimeout(r, 900));
}

const ok = runs.filter((r) => r.status === 200);
const providers = [...new Set(ok.map((r) => r.provider))];
const outputs = [...new Set(ok.map((r) => r.content))];
console.log(`\n  successful runs : ${ok.length}/${N}`);
console.log(`  distinct providers: ${providers.length} ${JSON.stringify(providers)}`);
console.log(`  distinct outputs  : ${outputs.length}`);
console.log(
  ok.length > 1 && outputs.length === 1
    ? "  >>> all runs agreed. Determinism holds ACROSS the providers seen here."
    : ok.length > 1
      ? "  >>> OUTPUTS DIFFERED. Seed+temperature is NOT sufficient on its own."
      : "  >>> too few successful runs to conclude anything.",
);

console.log(`\n=== B. Can the provider be PINNED? (the fix if A is unstable) ===`);
const pinned = await one({ provider: { order: ["Google"], allow_fallbacks: false } }, "pinned");
if (pinned.status === 200) {
  console.log(`  pinned request served by: ${pinned.provider}`);
  console.log(`  output: ${JSON.stringify(pinned.content.slice(0, 60))}`);
  console.log(`  >>> provider pinning is ACCEPTED by the API (order + allow_fallbacks: false).`);
} else {
  console.log(`  pinned request FAILED status=${pinned.status} ${pinned.error}`);
  console.log(`  >>> pinning rejected or unavailable — determinism cannot be forced this way.`);
}

await new Promise((r) => setTimeout(r, 900));

console.log(`\n=== C. Does an UNPINNED request still agree with the pinned one? ===`);
const plain = await one({}, "plain");
if (plain.status === 200 && pinned.status === 200) {
  const agree = plain.content === pinned.content;
  console.log(`  plain=${JSON.stringify(plain.content.slice(0, 50))}`);
  console.log(`  pinned=${JSON.stringify(pinned.content.slice(0, 50))}`);
  console.log(`  agree: ${agree ? "YES" : "NO"}`);
}

console.log(`\n=== D. Cost reporting, for logging from the response ===`);
const costs = ok.map((r) => r.cost).filter((c) => typeof c === "number");
if (costs.length) {
  console.log(`  per-call cost: ${costs.map((c) => "$" + c.toFixed(6)).join(", ")}`);
  console.log(`  mean: $${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(6)}`);
  console.log(`  >>> cost is reported per response, so the log needs no price table.`);
} else {
  console.log("  usage.cost was absent — cost would have to be computed from token counts.");
}

// The prompt is ~6.1k tokens for ONE opinion, so the plan's $0.013/citation estimate can be
// checked against reality rather than assumed.
const det = JSON.parse(
  JSON.stringify({
    note: "usage.cost is authoritative; this is the plan's estimate vs the measurement",
  }),
);
void det;
