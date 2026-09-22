// Phase 0 gate: confirm the OpenRouter credential actually WORKS, not merely that a
// variable is set. A var being present is not evidence it is valid — a session can be
// lost to two vars holding the same stale placeholder.
//
// This script deliberately NEVER prints the key, its length, a prefix, a suffix, or any
// substring of it. It reports only: whether a key was found, the HTTP status, and the
// model's own reply. Verification, not enumeration.
//
// Run: node .recon/verify-openrouter.mjs

import { readFileSync, existsSync } from "node:fs";

function readEnvFile(path) {
  if (!existsSync(path)) return null;
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

const fromFile = readEnvFile(".env") ?? {};
const key = process.env.OPENROUTER_API_KEY || fromFile.OPENROUTER_API_KEY || "";
const model = process.env.OPENROUTER_MODEL || fromFile.OPENROUTER_MODEL || "google/gemini-2.5-flash";

console.log("Phase 0 — OpenRouter credential verification");
console.log("  .env file present:      " + existsSync(".env"));
console.log("  OPENROUTER_API_KEY:     " + (key ? "found (value not printed)" : "NOT FOUND"));
console.log("  model under test:       " + model);

if (!key) {
  console.log("\nRESULT: no key configured. This is NOT a blocker — the belt is optional and the");
  console.log("        app degrades to the deterministic corpus path. Phase 6 stays blocked until");
  console.log("        a key is provided, so record it as a known gap rather than a failure.");
  process.exit(0);
}

// Guard against the classic placeholder trap: a value that is present but obviously not
// a real credential. We check the shape only, never the value.
const looksPlaceholder =
  /^(your|my|test|placeholder|changeme|xxx|todo|sk-xxx)/i.test(key) ||
  key.length < 20 ||
  /placeholder|changeme|example/i.test(key);
if (looksPlaceholder) {
  console.log("  shape:                  LOOKS LIKE A PLACEHOLDER (too short or a known stub word)");
}

console.log("  shape:                  length " + key.length + ", " + (key.startsWith("sk-or-") ? "OpenRouter prefix present" : "no sk-or- prefix"));
console.log("\n  issuing one live call…");

const t0 = Date.now();
let res, body;
try {
  res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/citeproof",
      "X-Title": "CiteProof",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16,
      temperature: 0,
      seed: 20260922,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
    }),
  });
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
} catch (e) {
  console.log("  NETWORK ERROR: " + e.message);
  process.exit(1);
}

const ms = Date.now() - t0;
console.log("  HTTP " + res.status + "  (" + ms + "ms)");

if (res.status === 200) {
  const choice = body.choices?.[0];
  console.log("  reply:                  " + JSON.stringify(choice?.message?.content));
  console.log("  finish_reason:          " + choice?.finish_reason);
  console.log("  model echoed:           " + body.model);
  const u = body.usage || {};
  console.log("  usage:                  prompt " + u.prompt_tokens + " / completion " + u.completion_tokens);
  console.log("  generation id:          " + (body.id || "(none)"));
  console.log("\nRESULT: PASS — credential works and the model responds. Phase 6 is unblocked.");
} else if (res.status === 401 || res.status === 403) {
  console.log("  body: " + JSON.stringify(body).slice(0, 300));
  console.log("\nRESULT: FAIL — the key is present but REJECTED. This is exactly the trap the");
  console.log("        viability gate exists to catch: a set-but-invalid credential. Do not plan");
  console.log("        around it; fix the key or plan the belt as unavailable.");
  process.exit(1);
} else if (res.status === 402) {
  console.log("  body: " + JSON.stringify(body).slice(0, 300));
  console.log("\nRESULT: key is VALID but has insufficient credits. Core still runs at $0; the");
  console.log("        belt needs credits. Record as a known gap.");
} else if (res.status === 429) {
  console.log("  body: " + JSON.stringify(body).slice(0, 300));
  console.log("\nRESULT: key is VALID but rate-limited right now. Retry later.");
} else {
  console.log("  body: " + JSON.stringify(body).slice(0, 400));
  console.log("\nRESULT: unexpected status — treat as unverified, not as passing.");
  process.exit(1);
}
