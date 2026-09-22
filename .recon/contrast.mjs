// Palette solver + verifier.
//
// Two things this script gets right that a naive check does not:
//  1. It SOLVES for a compliant value instead of guessing, by walking lightness down
//     in HSL while preserving hue and saturation.
//  2. It checks VERDICT MARKS for perceptual distance (CIE Lab dE76), not by WCAG
//     contrast ratio. A luminance ratio between two colours says nothing about whether
//     they look different — green and red can share a luminance and still be obviously
//     distinct. Using the ratio for that was a bug in the first version of this probe.
//
// Run: node .recon/contrast.mjs

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
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

// --- sRGB <-> HSL, so a solve preserves hue (the design's identity) ---
function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}
function hslToRgb([h, s, l]) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
const toHex = (rgb) =>
  "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");

/** Darken (or lighten) a colour in HSL until it meets `target` contrast against `bg`. */
function solve(colour, bg, target, direction = "darken") {
  const [h, s, l0] = rgbToHsl(hexToRgb(colour));
  if (ratio(colour, bg) >= target) return { hex: colour, ratio: ratio(colour, bg), moved: false };
  for (let step = 1; step <= 100; step++) {
    const l = direction === "darken" ? l0 - step * 0.01 : l0 + step * 0.01;
    if (l < 0 || l > 1) break;
    const hex = toHex(hslToRgb([h, s, l]));
    const r = ratio(hex, bg);
    if (r >= target) return { hex, ratio: r, moved: true };
  }
  return { hex: colour, ratio: ratio(colour, bg), moved: false, failed: true };
}

// --- CIE Lab + dE76, for "are these two marks perceptually different?" ---
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

const PAPER = "#f8f7f4";
const SURFACE = "#fffefa";

// Roles with the contrast target each must meet. Targets come from WCAG 2.1:
// 4.5 = normal text AA · 3.0 = large text AA / non-text UI component (1.4.11).
const ROLES = [
  { role: "ink (body text)", hex: "#292a26", bg: PAPER, target: 7 },
  { role: "muted (secondary text)", hex: "#777970", bg: PAPER, target: 4.5 },
  { role: "faint (metadata, non-essential)", hex: "#a8a99f", bg: PAPER, target: 3 },
  { role: "accent-ink (accent AS TEXT)", hex: "#f45e38", bg: PAPER, target: 4.5 },
  { role: "accent (fill only, not text)", hex: "#f45e38", bg: PAPER, target: 3 },
  { role: "on-accent (text ON the fill)", hex: "#3e2118", bg: "#f45e38", target: 4.5 },
  { role: "verified mark", hex: "#2f6b4f", bg: PAPER, target: 4.5 },
  { role: "misattributed mark", hex: "#b26b00", bg: PAPER, target: 4.5 },
  { role: "fabricated mark", hex: "#b02a1f", bg: PAPER, target: 4.5 },
  { role: "verified mark on card", hex: "#2f6b4f", bg: SURFACE, target: 4.5 },
  { role: "misattributed mark on card", hex: "#b26b00", bg: SURFACE, target: 4.5 },
  { role: "fabricated mark on card", hex: "#b02a1f", bg: SURFACE, target: 4.5 },
];

const pad = (s, n) => String(s).padEnd(n);
console.log("CiteProof palette — SOLVED LIGHT MODE\n");
console.log(pad("role", 38) + pad("current", 20) + pad("solved", 20) + "target");
console.log("-".repeat(96));

const solved = {};
for (const r of ROLES) {
  const s = solve(r.hex, r.bg, r.target);
  const before = `${r.hex} ${ratio(r.hex, r.bg).toFixed(2)}:1`;
  const after = `${s.hex} ${s.ratio.toFixed(2)}:1`;
  console.log(
    pad(r.role, 38) + pad(before, 20) + pad(after, 20) + `>=${r.target}` + (s.failed ? "  *** UNSOLVED ***" : ""),
  );
  solved[r.role] = s.hex;
}

// --- the quiet-verdict invariant, measured by CHROMA ---------------------
// Luminance is the wrong instrument for "quiet" — the same mistake as using it for
// distinctness. UNVERIFIABLE must be readable (so it needs luminance >= 4.5:1) while
// still reading as an absence of assertion. What makes it quiet is that it carries no
// HUE: a neutral grey reads as "no claim" while every accusatory mark is saturated.
// So the invariant is on chroma, plus the form rules documented in docs/DESIGN.md.
console.log("\n--- INVARIANT: UNVERIFIABLE must carry no semantic hue ---");
const chroma = (hex) => {
  const [, a, b] = rgbToLab(hex);
  return Math.hypot(a, b);
};
const muted = solved["muted (secondary text)"];
const marks = {
  verified: solved["verified mark"],
  misattributed: solved["misattributed mark"],
  fabricated: solved["fabricated mark"],
};
const mutedChroma = chroma(muted);
let quietOk = true;
for (const [k, v] of Object.entries(marks)) {
  const c = chroma(v);
  const ok = mutedChroma < c;
  if (!ok) quietOk = false;
  console.log(
    pad(`unverifiable chroma ${mutedChroma.toFixed(1)} vs ${k} ${c.toFixed(1)}`, 50) +
      (ok ? `OK — ${(c / Math.max(mutedChroma, 0.1)).toFixed(1)}x quieter` : "VIOLATED — it carries a hue"),
  );
}
console.log(
  pad(`unverifiable still readable? ${ratio(muted, PAPER).toFixed(2)}:1`, 50) +
    (ratio(muted, PAPER) >= 4.5 ? "OK — reads as text" : "FAIL — too faint to read"),
);

// --- perceptual distinctness of the verdict marks ------------------------
console.log("\n--- verdict marks: perceptual distance (CIE Lab dE76) ---");
console.log("    (WCAG ratio is the WRONG instrument here — it measures legibility against a");
console.log("     background, not whether two colours look different. dE is the right one.)");
const keys = Object.keys(marks);
for (let i = 0; i < keys.length; i++) {
  for (let j = i + 1; j < keys.length; j++) {
    const d = deltaE(marks[keys[i]], marks[keys[j]]);
    console.log(
      pad(`${keys[i]} vs ${keys[j]}`, 44) + pad(d.toFixed(1), 10) +
        (d >= 25 ? "clearly distinct" : d >= 12 ? "distinguishable" : "TOO CLOSE"),
    );
  }
}

console.log("\n--- NOTE: colour is never the sole signal (WCAG 1.4.1) ---");
console.log("Every verdict renders a drawn SVG glyph AND a text label, so the result survives");
console.log("greyscale printing and every form of colour-vision deficiency. The palette above is");
console.log("a reinforcement, not the carrier.");

// --- dark mode check ----------------------------------------------------
const DARK = { paper: "#1b1a18", ink: "#f0eee8", muted: "#a3a196", verified: "#7fc79f", misattributed: "#e0a94a", fabricated: "#f08a7e", accent: "#ffb59f", onAccent: "#2a1810" };
console.log("\n--- DARK MODE pairs ---");
for (const [fgK, bgK, target] of [
  ["ink", "paper", 7], ["muted", "paper", 4.5], ["verified", "paper", 4.5],
  ["misattributed", "paper", 4.5], ["fabricated", "paper", 4.5], ["accent", "paper", 4.5],
  ["onAccent", "accent", 4.5],
]) {
  const r = ratio(DARK[fgK], DARK[bgK]);
  console.log(pad(`${fgK} on ${bgK}`, 44) + pad(r.toFixed(2) + ":1", 10) + (r >= target ? `pass (>=${target})` : `FAIL (need ${target})`));
}

console.log("\n=== values to paste into styles/tokens.css ===");
console.log(JSON.stringify({
  "--ink": solved["ink (body text)"],
  "--muted": solved["muted (secondary text)"],
  "--faint": solved["faint (metadata, non-essential)"],
  "--accent": solved["accent (fill only, not text)"],
  "--accent-ink": solved["accent-ink (accent AS TEXT)"],
  "--on-accent": solved["on-accent (text ON the fill)"],
  "--verified": solved["verified mark"],
  "--misattributed": solved["misattributed mark"],
  "--fabricated": solved["fabricated mark"],
}, null, 2));
console.log(`\nquiet-verdict invariant: ${quietOk ? "HOLDS" : "VIOLATED — fix before shipping"}`);

// --- POSITIVE CONTROL ----------------------------------------------------
// A clean report from a blind checker looks identical to a clean report from a working
// one. So plant failures that MUST be caught. If these come back "pass", the whole
// run above is worthless and this script says so.
console.log("\n--- POSITIVE CONTROL (planted failures — all four MUST be flagged) ---");
const controls = [
  { label: "tan-on-cream (the class of bug that deleted a CTA)", fg: "#f0e5d0", bg: "#f5ede0", target: 4.5, mustFail: true },
  { label: "identical colours (1.00:1)", fg: "#8a8a8a", bg: "#8a8a8a", target: 4.5, mustFail: true },
  { label: "white text on the terracotta fill", fg: "#ffffff", bg: "#f45e38", target: 4.5, mustFail: true },
  { label: "accent fill used as link text", fg: "#f45e38", bg: PAPER, target: 4.5, mustFail: true },
  { label: "ink on paper (control that SHOULD pass)", fg: "#292a26", bg: PAPER, target: 4.5, mustFail: false },
];
let controlOk = true;
for (const c of controls) {
  const r = ratio(c.fg, c.bg);
  const failed = r < c.target;
  const correct = failed === c.mustFail;
  if (!correct) controlOk = false;
  console.log(
    pad(c.label, 52) + pad(r.toFixed(2) + ":1", 10) +
      (correct ? (failed ? "correctly flagged" : "correctly passed") : "*** CONTROL FAILED — PROBE IS BLIND ***"),
  );
}
console.log(
  controlOk
    ? "\nCONTROL PASSED — the checker detects failures and passes good pairs, so the results above are trustworthy."
    : "\nCONTROL FAILED — do not trust anything this script printed.",
);
if (!controlOk) process.exit(1);
