// Palette verifier — reads the SHIPPED tokens, never a copy of them.
//
// ## Why this was rewritten
//
// The first version kept its own table of hex values and *solved* for compliant ones: it printed a
// "current" column that had been the truth when it was written, and a "solved" column that later
// became the truth. So it reported `muted #777970 4.12:1` as current while `styles/tokens.css`
// shipped `#6f7169`, and nothing failed — the file had moved and the instrument had not. A palette
// check that reads a transcription of the palette verifies the transcription.
//
// It now parses `styles/tokens.css` and verifies the values that are actually in the build, and it
// cannot drift, because there is only one copy again.
//
// ## Two measurement choices that are deliberate, not incidental
//
//  1. VERDICT MARKS are checked for perceptual distance with CIE Lab dE76, not with a WCAG ratio.
//     A luminance ratio measures legibility against a background; it says nothing about whether two
//     colours look different. Green and red can share a luminance and still be obviously distinct.
//     Measured here: `verified vs fabricated` scores 1.04:1 — which reads as "nearly identical" and
//     is meaningless — while dE76 is 65.8, clearly distinct. The ratio nearly caused a working
//     palette to be rebuilt.
//  2. "WHICH MARK IS QUIETEST" is decided by CHROMA, not by luminance. The refusal mark wins by
//     carrying no hue at all (chroma 3.2 against 23.5–73.4), so it reads as an absence of assertion
//     while still being perfectly legible. By ratio it looks *louder* than an accusation, because a
//     valid mid-grey out-contrasts a valid muted amber. Wrong instrument, real number.
//
// Run: node .recon/contrast.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(process.cwd(), "styles/tokens.css"), "utf8");

// --- parse the two token sets straight out of the stylesheet ---------------------

/** Every `--name: value;` inside `block`, comments stripped. */
function tokensIn(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[m[1]] = m[2].replace(/\/\*[\s\S]*?\*\//g, "").trim();
  }
  return out;
}

/** The `:root { … }` block that is NOT inside the dark-mode media query. */
function lightBlock() {
  const darkStart = CSS.indexOf("@media (prefers-color-scheme: dark)");
  return CSS.slice(0, darkStart === -1 ? CSS.length : darkStart);
}

const LIGHT = tokensIn(lightBlock());
const DARK = tokensIn(CSS.slice(CSS.indexOf("@media (prefers-color-scheme: dark)")));

// The guard is what keeps this checker honest: if a token is renamed or dropped, it must fail loudly
// rather than checking a `undefined` value against a target and printing a pass.
const REQUIRED_LIGHT = [
  "paper", "surface", "line", "line-strong", "ink", "muted", "faint",
  "accent", "accent-hover", "accent-ink", "accent-ink-hover", "on-accent",
  "verified", "misattributed", "fabricated",
];
const REQUIRED_DARK = [...REQUIRED_LIGHT];

const missing = [
  ...REQUIRED_LIGHT.filter((t) => !LIGHT[t]).map((t) => `light --${t}`),
  ...REQUIRED_DARK.filter((t) => !DARK[t]).map((t) => `dark --${t}`),
  ...(DARK.paper ? [] : ["dark mode block"]),
];
if (missing.length) {
  console.error(`tokens.css no longer defines: ${missing.join(", ")}.\nThis checker is out of date.`);
  process.exit(2);
}

// --- colour maths ----------------------------------------------------------------

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexToRgb = (hex) => {
  const h = hex.replace("#", "").trim();
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lum = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

function rgbToLab(hex) {
  const [R, G, B] = hexToRgb(hex);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const deltaE = (a, b) => {
  const [l1, a1, b1] = rgbToLab(a), [l2, a2, b2] = rgbToLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};
const chroma = (hex) => {
  const [, a, b] = rgbToLab(hex);
  return Math.hypot(a, b);
};

const pad = (s, n) => String(s).padEnd(n);
const col = (s, n) => String(s).padStart(n);

// --- the pairs the UI actually renders -------------------------------------------
//
// Every entry is a foreground/background pair that exists in a stylesheet in this repo, with the
// surface it really sits on. A pair that is not on this list is a pair nobody verified, so the list
// is the specification: adding a hue to a new surface means adding a row here.
//
// Targets are WCAG 2.1: 4.5 = normal text AA · 3.0 = large text AA and non-text UI (1.4.11).
// 7.0 is used for body ink because it is free to hold it there.

const PAIRS = [
  // --- document and body text -----------------------------------------------------
  ["ink", "paper", 7.0, "body text on the page"],
  ["ink", "surface", 7.0, "document text in the brief sheet, true-home name, belt text"],

  ["muted", "paper", 4.5, "secondary prose, excerpts, meta"],
  ["muted", "surface", 4.5, "rail citation, legend copy, tally label, candidate rows"],

  ["faint", "paper", 3.0, "section labels, colophon head"],
  ["faint", "surface", 3.0, "field label, legend mark key, excerpt caption, rank note"],

  // --- the accent -----------------------------------------------------------------
  ["accent-ink", "paper", 4.5, "links in prose"],
  ["accent-ink", "surface", 4.5, "wordmark hover, sample control, source link, true-home link"],
  ["accent-ink-hover", "paper", 4.5, "link hover (goes DARKER, not lighter)"],
  ["on-accent", "accent", 4.5, "primary button label on its fill"],
  ["on-accent", "accent-hover", 4.5, "primary button label while hovered"],
  ["accent", "surface", 3.0, "button fill against the panel (non-text)"],
  ["accent", "paper", 3.0, "focus ring and field border (non-text)"],

  // --- verdict marks and labels ---------------------------------------------------
  ["verified", "paper", 4.5, "verified mark in prose"],
  ["misattributed", "paper", 4.5, "misattributed mark in prose"],
  ["fabricated", "paper", 4.5, "fabricated mark, error rule"],
  ["verified", "surface", 4.5, "verified mark in legend, rail, tally"],
  ["misattributed", "surface", 4.5, "misattributed mark in legend, rail, tally"],
  ["fabricated", "surface", 4.5, "fabricated mark in legend, rail, tally"],
  ["muted", "surface", 4.5, "unverifiable mark and label (it borrows muted — no hue of its own)"],
  ["fabricated", "surface", 4.5, "unsupported-belt dot, which carries a label too"],
  ["verified", "surface", 4.5, "supported-belt dot, which carries a label too"],

  // --- non-text boundaries --------------------------------------------------------
  //
  // These are checked because a mark that carries a STATE is a non-text UI component under WCAG
  // 1.4.11 and needs 3:1. `--line` is not on this list and that is deliberate: it draws decorative
  // hairlines between blocks, which the spec exempts, and it measures 1.22:1 — so it is excluded by
  // decision and named here rather than left off silently. `--line-strong` measures 1.47:1 and is
  // therefore NOT used for the unverifiable underline any more; that is `--muted`.
  ["line-strong", "paper", 3.0, "disabled control border, field border (non-text boundary)"],
  ["line-strong", "surface", 3.0, "same border where the control sits on a panel"],
];

/** Pairs that are deliberately exempt from the targets, recorded so the exemption is visible. */
const EXEMPT = [
  ["line", "paper", "--line draws decorative hairlines between blocks; WCAG exempts them, and it is 1.22:1"],
  ["line", "surface", "--line hairlines on a panel; decorative, exempt, 1.35:1"],
];

// A pair naming a token that does not exist would compare `undefined` against a target and could
// print a pass by accident, so every token named in PAIRS is resolved before anything is measured.
for (const [fgK, bgK] of PAIRS) {
  for (const [set, label] of [[LIGHT, "light"], [DARK, "dark"]]) {
    for (const key of [fgK, bgK]) {
      if (!set[key]) {
        console.error(`PAIRS references --${key} (${label}), which tokens.css does not define.`);
        process.exit(2);
      }
    }
  }
}

function check(tokenSet, mode) {
  console.log(`\n${"=".repeat(94)}`);
  console.log(`${mode} — ${PAIRS.length} foreground/background pairs, values read from styles/tokens.css`);
  console.log("=".repeat(94));
  console.log(pad("foreground", 20) + pad("on", 16) + pad("value", 22) + pad("ratio", 10) + "target");

  let failed = 0;
  const notes = [];
  for (const [fgK, bgK, target, usage] of PAIRS) {
    const fg = tokenSet[fgK];
    const bg = tokenSet[bgK];
    if (!fg || !bg) {
      console.log(pad(fgK, 20) + pad(bgK, 16) + "*** token missing ***");
      failed++;
      continue;
    }
    const r = ratio(fg, bg);
    const ok = r >= target;
    if (!ok) failed++;
    console.log(
      pad(fgK, 20) + pad(bgK, 16) +
        pad(`${fg} on ${bg}`, 22) +
        col(`${r.toFixed(2)}:1`, 8) + "  " +
        col(`>=${target.toFixed(1)}`, 7) + "  " + (ok ? "pass" : "FAIL") + `   ${usage}`,
    );
    if (usage.includes("excluded")) notes.push(`${fgK} on ${bgK}: ${r.toFixed(2)}:1 — ${usage}`);
  }
  return { failed, notes };
}

const light = check(LIGHT, "LIGHT MODE (warm paper)");
const dark = check(DARK, "DARK MODE (warm dark, accent retired for near-white)");

// --- deliberate exemptions, printed so they cannot be mistaken for omissions ------

console.log(`\n${"=".repeat(94)}`);
console.log("DELIBERATE EXEMPTIONS (measured and named, not silently skipped)");
console.log("=".repeat(94));
for (const [fgK, bgK, why] of EXEMPT) {
  for (const [set, label] of [[LIGHT, "light"], [DARK, "dark"]]) {
    if (!set[fgK] || !set[bgK]) continue;
    console.log(pad(`--${fgK} on --${bgK} (${label})`, 34) + pad(`${ratio(set[fgK], set[bgK]).toFixed(2)}:1`, 11) + why);
  }
}

// --- the two invariants a ratio cannot express -----------------------------------

console.log(`\n${"=".repeat(94)}`);
console.log("INVARIANT: the refusal must be the QUIETEST mark — measured by CHROMA, not luminance");
console.log("=".repeat(94));
console.log("A luminance ratio answers 'can I read it'; it cannot answer 'is it quiet'. The");
console.log("refusal is quiet because it carries no HUE, so the test is chroma + readability.\n");

const lightMarks = { verified: LIGHT.verified, misattributed: LIGHT.misattributed, fabricated: LIGHT.fabricated };
const lightQuiet = LIGHT.muted;
let quietOk = true;
for (const [k, v] of Object.entries(lightMarks)) {
  const c = chroma(v);
  const q = chroma(lightQuiet);
  const ok = q < c;
  if (!ok) quietOk = false;
  console.log(
    pad(`unverifiable chroma ${q.toFixed(1)} vs ${k} ${c.toFixed(1)}`, 52) +
      (ok ? `OK — ${(c / Math.max(q, 0.1)).toFixed(1)}x quieter` : "VIOLATED — the refusal carries a hue"),
  );
}
const mutedReads = ratio(lightQuiet, LIGHT.paper);
console.log(pad(`unverifiable still readable on paper ${mutedReads.toFixed(2)}:1`, 52) +
  (mutedReads >= 4.5 ? "OK — reads as text, not as faintness" : "FAIL — too faint to read"));
if (mutedReads < 4.5) quietOk = false;

console.log(`\n${"=".repeat(94)}`);
console.log("INVARIANT: the marks must be perceptually DISTINCT — CIE Lab dE76, not a contrast ratio");
console.log("=".repeat(94));
console.log("WCAG ratio is the wrong instrument here and it is worth seeing why: `verified vs");
console.log("fabricated` scores about 1.04:1, which reads as 'nearly identical'. dE says otherwise.\n");

const keys = Object.keys(lightMarks);
let distinctOk = true;
for (let i = 0; i < keys.length; i++) {
  for (let j = i + 1; j < keys.length; j++) {
    const d = deltaE(lightMarks[keys[i]], lightMarks[keys[j]]);
    const r = ratio(lightMarks[keys[i]], lightMarks[keys[j]]);
    if (d < 12) distinctOk = false;
    console.log(
      pad(`${keys[i]} vs ${keys[j]}`, 34) +
        pad(`dE76 ${d.toFixed(1)}`, 14) +
        pad(`(ratio would say ${r.toFixed(2)}:1)`, 30) +
        (d >= 25 ? "clearly distinct" : d >= 12 ? "distinguishable" : "TOO CLOSE"),
    );
  }
}

// --- positive control ------------------------------------------------------------

console.log(`\n${"=".repeat(94)}`);
console.log("POSITIVE CONTROL — planted pairs that MUST be flagged, and one that must pass");
console.log("=".repeat(94));
console.log("A checker that reports a clean palette looks identical to a checker that is blind.\n");

const controls = [
  { label: "identical colours (1.00:1)", fg: "#8a8a8a", bg: "#8a8a8a", target: 4.5, mustFail: true },
  { label: "manila CTA on a manila folder (the shipped bug)", fg: "#f0e5d0", bg: "#f5ede0", target: 4.5, mustFail: true },
  { label: "white on the terracotta fill", fg: "#ffffff", bg: LIGHT.accent, target: 4.5, mustFail: true },
  { label: "accent FILL used as link text", fg: LIGHT.accent, bg: LIGHT.paper, target: 4.5, mustFail: true },
  { label: "the old pre-fix muted, which shipped at 4.12:1", fg: "#777970", bg: LIGHT.paper, target: 4.5, mustFail: true },
  { label: "ink on paper (control that SHOULD pass)", fg: LIGHT.ink, bg: LIGHT.paper, target: 4.5, mustFail: false },
];
let controlOk = true;
for (const c of controls) {
  const r = ratio(c.fg, c.bg);
  const didFail = r < c.target;
  const correct = didFail === c.mustFail;
  if (!correct) controlOk = false;
  console.log(
    pad(c.label, 54) + pad(`${r.toFixed(2)}:1`, 11) +
      (correct ? (didFail ? "correctly flagged" : "correctly passed") : "*** CONTROL FAILED — CHECKER IS BLIND ***"),
  );
}

// --- verdict ---------------------------------------------------------------------

const totalFailed = light.failed + dark.failed;
console.log(`\n${"=".repeat(94)}`);
for (const n of [...light.notes, ...dark.notes]) console.log(`note: ${n}`);
console.log(`\nWCAG pairs: ${PAIRS.length * 2 - totalFailed} pass / ${totalFailed} fail`);
console.log(`quiet-refusal invariant: ${quietOk ? "HOLDS" : "VIOLATED"}`);
console.log(`mark distinctness:       ${distinctOk ? "HOLDS" : "VIOLATED"}`);
console.log(`positive control:        ${controlOk ? "PASSED" : "FAILED"}`);

const verdict = totalFailed === 0 && quietOk && distinctOk && controlOk;
console.log(
  verdict
    ? "\nPALETTE VERIFIED — every rendered pair meets its target, read from the shipped tokens."
    : "\nPALETTE NOT VERIFIED — see the failures above.",
);
process.exit(verdict ? 0 : 1);
