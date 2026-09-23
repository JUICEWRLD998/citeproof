/**
 * probe-seed-determinism.mjs — Phase 6's load-bearing claim, measured.
 *
 * THE CLAIM. `implementation.md` §3.3 asserts: "`seed` + `temperature: 0` ⇒ the belt is
 * reproducible on camera. Pin both, and record the seed in the fixture file." The whole demo
 * narrative rests on it — a replayable run is the difference between "watch this audit" and
 * "it said something different this time".
 *
 * THE PROBLEM. OpenRouter LOAD-BALANCES ACROSS PROVIDERS by default, and the plan flags this
 * itself: "quantisation can differ". A `seed` is a per-provider parameter; if two identical
 * requests land on two different providers, identical output is not guaranteed by anything in
 * the protocol. So the claim is either true and worth leaning on, or it is a demo that breaks
 * on stage — and only a live measurement can tell those apart.
 *
 * WHAT THIS MEASURES:
 *   1. Do two identical requests (same seed, temperature 0) return byte-identical output?
 *   2. Which provider served each request? (If they differ, determinism is coincidence, not
 *      a guarantee, and the fix is to PIN the provider.)
 *   3. Is `response_format: json_schema` actually honoured — real parsed JSON, not prose?
 *   4. What does the usage block report, so cost can be logged from the response rather than
 *      estimated?
 *
 * Also deliberately probes an adversarial case: does the model invent a span when the
 * proposition is NOT supported by the opinion? That is the failure the belt exists to be
 * checked for, and if the model refuses honestly, the product claim gets stronger.
 *
 * Run: node .recon/probe-seed-determinism.mjs
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

if (!KEY) {
  console.error("no key: set OPENROUTER_API_KEY or put it in .env");
  process.exit(1);
}
console.log(`model ${MODEL} · seed ${SEED} · key ${KEY.slice(0, 8)}… (value not printed in full)\n`);

const opinion = JSON.parse(readFileSync("fixtures/corpus/us-347-0483-01.json", "utf8")).text;

/** The schema the belt will actually use: a span proposal, nothing else. */
const SCHEMA = {
  name: "span_proposal",
  strict: true,
  schema: {
    type: "object",
    properties: {
      proposedSpan: {
        type: "string",
        description:
          "The single sentence from the opinion that most directly supports the proposition. It MUST be copied character-for-character from the opinion. If no sentence supports it, return an empty string.",
      },
      selfReportedConfidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["proposedSpan", "selfReportedConfidence"],
    additionalProperties: false,
  },
};

const SUPPORTED = "Racial segregation in public education violates the Equal Protection Clause.";
// Deliberately unsupported: nothing in Brown establishes a right to jury trial.
const UNSUPPORTED = "The Seventh Amendment guarantees a jury trial in all civil actions.";

function body(proposition) {
  return {
    model: MODEL,
    temperature: 0,
    seed: SEED,
    response_format: { type: "json_schema", json_schema: SCHEMA },
    messages: [
      {
        role: "system",
        content:
          "You extract verbatim quotations from a judicial opinion. Copy text character-for-character. Never paraphrase. If no sentence supports the proposition, return an empty proposedSpan.",
      },
      {
        role: "user",
        content: `OPINION:\n${opinion}\n\nPROPOSITION:\n${proposition}\n\nReturn the single supporting sentence, copied exactly.`,
      },
    ],
  };
}

async function call(proposition, label) {
  const t0 = Date.now();
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/JUICEWRLD98/citeproof",
      "X-Title": "CiteProof",
    },
    body: JSON.stringify(body(proposition)),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  if (res.status !== 200) {
    console.log(`${label}: HTTP ${res.status} — ${text.slice(0, 300)}`);
    return null;
  }
  const json = JSON.parse(text);
  const content = json.choices?.[0]?.message?.content ?? "";
  let parsed = null;
  let parseKind = "unparseable";
  try {
    parsed = JSON.parse(content);
    parseKind = "json";
  } catch {
    parseKind = "PROSE/NOT-JSON";
  }
  return {
    ms,
    provider: json.provider ?? "(not reported)",
    model: json.model,
    finish: json.choices?.[0]?.finish_reason,
    content,
    parsed,
    parseKind,
    usage: json.usage,
    id: json.id,
  };
}

function preview(s, n = 110) {
  return JSON.stringify(s.length > n ? s.slice(0, n) + "…" : s);
}

console.log("=== 1. SUPPORTED proposition, run A ===");
const a = await call(SUPPORTED, "A");
if (!a) process.exit(1);
console.log(`provider=${a.provider}  latency=${a.ms}ms  finish=${a.finish}  content=${a.parseKind}`);
console.log(`usage=${JSON.stringify(a.usage)}`);
console.log(`proposedSpan=${preview(a.parsed?.proposedSpan ?? a.content)}`);

await new Promise((r) => setTimeout(r, 1500));

console.log("\n=== 2. SUPPORTED proposition, run B (identical request) ===");
const b = await call(SUPPORTED, "B");
if (!b) process.exit(1);
console.log(`provider=${b.provider}  latency=${b.ms}ms  content=${b.parseKind}`);
console.log(`proposedSpan=${preview(b.parsed?.proposedSpan ?? b.content)}`);

const identical = a.content === b.content;
console.log(`\n>>> BYTE-IDENTICAL across two runs: ${identical ? "YES" : "NO"}`);
console.log(`>>> same provider: ${a.provider === b.provider ? "YES" : `NO (${a.provider} vs ${b.provider})`}`);
if (!identical && a.provider === b.provider) {
  console.log(">>> different output from the SAME provider despite seed+temperature 0 —");
  console.log("    determinism is not guaranteed, so the demo must not claim a byte-stable replay.");
} else if (!identical) {
  console.log(">>> different providers served the runs — seed is per-provider, so pin the provider.");
}

console.log("\n=== 3. Is the proposed span VERBATIM in the opinion? ===");
for (const [label, r] of [["A", a], ["B", b]]) {
  const span = r.parsed?.proposedSpan ?? "";
  if (!span) {
    console.log(`${label}: empty span (model declined)`);
    continue;
  }
  const exact = opinion.includes(span);
  const folded = opinion.toLowerCase().includes(span.toLowerCase());
  console.log(`${label}: exact=${exact}  casefolded-only=${!exact && folded}`);
}

await new Promise((r) => setTimeout(r, 1500));

console.log("\n=== 4. UNSUPPORTED proposition — does the model invent a span? ===");
const c = await call(UNSUPPORTED, "C");
if (c) {
  console.log(`provider=${c.provider}  finish=${c.finish}  content=${c.parseKind}`);
  console.log(`proposedSpan=${preview(c.parsed?.proposedSpan ?? c.content)}`);
  const span = c.parsed?.proposedSpan ?? "";
  if (!span) {
    console.log(">>> model returned an EMPTY span — it declined honestly.");
  } else {
    const found = opinion.includes(span);
    console.log(`>>> model DID propose a span; verbatim in the opinion: ${found}`);
    if (!found) {
      console.log(">>> ★ THE FAILURE MODE THE BELT EXISTS FOR: fabricated span, caught by the matcher.");
    } else {
      console.log(">>> span is real but supports nothing: not catchable by a text matcher alone.");
    }
  }
}
