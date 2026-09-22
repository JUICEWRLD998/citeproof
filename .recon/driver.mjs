// Headless Chrome driver over CDP. Zero dependencies: Node 24 has fetch + WebSocket.
//
// Usage:  node .recon/driver.mjs [url] [outdir] [width] [height]
//
// Why a driver at all: a class-name grep cannot see a control rendered in its own
// background colour, and tsc cannot see a font that silently snapped to the wrong
// weight. If we have not looked at it, we do not know it works.
//
// Four disciplines, each bought with a past mistake:
//  1. PLANE CONTROLS — a DOM probe that cannot detect a planted failure is blind, and a
//     blind probe reports a confident PASS. Plant failures; require them caught.
//  2. HASHED CLASSES — CSS Modules hash class names at build time, so a selector like
//     `.railLabel` matches NOTHING and a probe silently measures the empty set. Class
//     hooks here are `[class*="..."]`.
//  3. KILL TRANSITIONS before any synchronous computed-style read, or the read returns
//     the PREVIOUS frame.
//  4. STATE THE COLOUR SCHEME. Headless Chrome reports `prefers-color-scheme: dark` by
//     default, so an unqualified light-mode assertion fails against a working page.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] ?? "http://localhost:3100/";
const OUTDIR = process.argv[3] ?? ".recon/shots";
const WIDTH = Number(process.argv[4] ?? 1280);
const HEIGHT = Number(process.argv[5] ?? 1700);
const PORT = 9333;

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = join(tmpdir(), `citeproof-cdp-${Date.now()}`);
mkdirSync(profile, { recursive: true });
mkdirSync(OUTDIR, { recursive: true });

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", () => rej(new Error("websocket error")));
  });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method && events.has(m.method)) {
      for (const fn of events.get(m.method)) fn(m.params);
      events.delete(m.method);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = ++id;
      pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  const once = (method) =>
    new Promise((resolve) => {
      if (!events.has(method)) events.set(method, []);
      events.get(method).push(resolve);
    });
  return { send, once, ready, close: () => ws.close() };
}

const bin = CHROME.find((p) => existsSync(p));
if (!bin) {
  console.error("No Chrome/Chromium found. Checked:\n  " + CHROME.join("\n  "));
  process.exit(2);
}
const proc = spawn(
  bin,
  [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--force-device-scale-factor=1",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`, "about:blank",
  ],
  { stdio: "ignore" },
);

let wsUrl = null;
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p = list.find((t) => t.type === "page");
    if (p) { wsUrl = p.webSocketDebuggerUrl; break; }
  } catch {}
  await sleep(250);
}
if (!wsUrl) {
  console.error("Chrome did not expose a page target within 20s.");
  proc.kill();
  process.exit(2);
}

const c = cdp(wsUrl);
await c.ready;
await c.send("Page.enable");
await c.send("Runtime.enable");
await c.send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: WIDTH < 600,
});

const loaded = c.once("Page.loadEventFired");
await c.send("Page.navigate", { url: URL_ });
await loaded;
await sleep(1400); // fonts

// Plant the controls once, in both modes.
await c.send("Runtime.evaluate", {
  expression: `(() => {
    const s = document.createElement('style');
    s.id = '__killmotion';
    s.textContent = '*{transition:none !important;animation:none !important}';
    document.head.appendChild(s);
    const mk = (id, w) => { const e = document.createElement('span'); e.id = id; e.textContent = '.'; e.style.fontWeight = w; document.body.appendChild(e); };
    mk('__ctl550', '550'); mk('__ctl400', '400'); mk('__ctl500', '500');
  })();`,
});

const PROBE = `(() => {
  const cs = (el) => el ? getComputedStyle(el) : null;
  const q = (needle) => document.querySelector('[class*="' + needle + '"]');
  const qa = (needle) => [...document.querySelectorAll('[class*="' + needle + '"]')];

  // Measure EVERY unique computed font-weight in use, by family, so nothing is assumed.
  // EXCLUDE our own planted controls: they are the instrument, not the page. Counting
  // them here made the probe report a stray 500 that was only ever __ctl500 — the
  // measurement contaminating its own sample.
  const sansWeights = {}, monoWeights = {};
  let sansCount = 0, monoCount = 0;
  for (const el of document.querySelectorAll('*')) {
    if (el.id && el.id.startsWith('__ctl')) continue;
    const s = cs(el);
    if (!el.textContent || !el.textContent.trim()) continue;
    const isMono = /Mono/i.test(s.fontFamily);
    const w = s.fontWeight;
    if (isMono) { monoWeights[w] = (monoWeights[w] || 0) + 1; monoCount++; }
    else { sansWeights[w] = (sansWeights[w] || 0) + 1; sansCount++; }
  }

  const accentEl = document.querySelector('a');
  const h3s = [...document.querySelectorAll('h3')].map(e => cs(e).fontWeight);

  return {
    scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    title: document.title,
    wordmark: (() => { const h = document.querySelector('h1'); return h ? { text: h.textContent.trim(), weight: cs(h).fontWeight, size: cs(h).fontSize } : null; })(),
    hero: (() => { const h = document.querySelector('h2'); return h ? { weight: cs(h).fontWeight, size: cs(h).fontSize } : null; })(),
    sansWeights, monoWeights, sansCount, monoCount,
    h3Weights: h3s,
    linkColour: accentEl ? cs(accentEl).color : null,
    bodyBg: cs(document.body).backgroundColor,
    bodyColor: cs(document.body).color,
    control550: cs(document.getElementById('__ctl550')).fontWeight,
    control400: cs(document.getElementById('__ctl400')).fontWeight,
    control500: cs(document.getElementById('__ctl500')).fontWeight,
    dmSansLoaded: [...document.fonts].some(f => /DM Sans/i.test(f.family) && f.status === 'loaded'),
    dmMonoLoaded: [...document.fonts].some(f => /DM Mono/i.test(f.family) && f.status === 'loaded'),
    hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    svgCount: document.querySelectorAll('svg').length,
    railLabels: qa('railLabel').map(e => e.textContent.trim()),
    railCites: qa('railCite').map(e => e.textContent.trim()),
    /*
     * Rail rhythm is the load-bearing layout in this design: every citation gets a left
     * column and its verdict mark must line up horizontally with the others. Measuring
     * the mark's offset from the top of its own audited line is the only way to catch a
     * wrapped citation silently knocking one mark out of step.
     */
    railCiteLines: qa('railCite').map((e) => {
      const s = cs(e);
      const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
      return { text: e.textContent.trim(), lines: Math.round(e.clientHeight / lh) };
    }),
    railMarkOffsets: qa('railMark').map((e) => {
      const line = e.closest('[class*="auditedLine"]');
      return line ? Math.round(e.getBoundingClientRect().top - line.getBoundingClientRect().top) : null;
    }),
    legendNames: qa('legendName').map(e => e.textContent.trim()),
    struckCount: qa('struck').length,
    dashedRuleCount: qa('unverifiableRule').length,
    transitionsKilled: getComputedStyle(document.getElementById('__ctl550')).transitionDuration,
  };
})()`;

async function run(mode, file) {
  await c.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: mode }],
  });
  await sleep(450);
  const r = await c.send("Runtime.evaluate", { returnByValue: true, expression: PROBE });
  if (r.exceptionDetails) throw new Error("probe threw: " + JSON.stringify(r.exceptionDetails));
  const d = r.result.value;
  const shot = await c.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(OUTDIR, file), Buffer.from(shot.data, "base64"));
  return d;
}

const light = await run("light", "light-desktop.png");
const dark = await run("dark", "dark-desktop.png");

console.log("chrome:", bin, "\n");

for (const [mode, d] of [["LIGHT", light], ["DARK", dark]]) {
  console.log(`================ ${mode} MODE ================`);
  console.log(`  scheme reported by page:  ${d.scheme}`);
  console.log(`  body bg / ink:            ${d.bodyBg} / ${d.bodyColor}`);
  console.log(`  wordmark:                 ${d.wordmark?.weight}  ${d.wordmark?.size}`);
  console.log(`  hero heading:             ${d.hero?.weight}  ${d.hero?.size}`);
  console.log(`  sans weights in use:      ${JSON.stringify(d.sansWeights)}`);
  console.log(`  mono weights in use:      ${JSON.stringify(d.monoWeights)}`);
  console.log(`  h3 weights:               ${JSON.stringify(d.h3Weights)}`);
  console.log(`  link colour:              ${d.linkColour}`);
  console.log(`  DM Sans / DM Mono loaded: ${d.dmSansLoaded} / ${d.dmMonoLoaded}`);
  console.log(`  overflow @${WIDTH}px:         ${d.hasOverflow ? "YES " + d.scrollW + ">" + d.clientW : "no"}`);
  console.log(`  svg marks:                ${d.svgCount}`);
  console.log(`  rail labels:              ${JSON.stringify(d.railLabels)}`);
  console.log(`  rail cites:               ${JSON.stringify(d.railCites.slice(0, 2))}`);
  console.log(`  rail cite line counts:    ${JSON.stringify(d.railCiteLines.map((r) => r.lines))}`);
  console.log(`  rail mark top offsets:    ${JSON.stringify(d.railMarkOffsets)}`);
  console.log(`  struck / dashed rule:     ${d.struckCount} / ${d.dashedRuleCount}`);
  console.log("");
}

// Rail rhythm: every cite on one line, and every verdict mark at the same offset.
const citeLinesOk = light.railCiteLines.every((r) => r.lines === 1);
const offsets = light.railMarkOffsets.filter((o) => o !== null);
const offsetsAligned = offsets.length > 0 && new Set(offsets).size === 1;

// ---------------- control adjudication ----------------
console.log("=== CONTROL ADJUDICATION (a blind probe must be caught here) ===");
const ctlOk =
  light.control550 === "550" && light.control400 === "400" && light.control500 === "500" &&
  new Set([light.control550, light.control400, light.control500]).size === 3;
console.log(`  planted 550/400/500 read back as ${light.control550}/${light.control400}/${light.control500}`);
console.log(`  probe can separate the three weights: ${ctlOk ? "YES" : "NO — PROBE IS BLIND, ignore all weights above"}`);

// ---------------- acceptance ----------------
// Every heading/label on this page must state its weight EXPLICITLY. Mono labels use 500
// (DM Mono ships 400/500 only); sans UI uses 550.
const sansBad = Object.keys(light.sansWeights).filter((w) => !["400", "550", "650", "750"].includes(w));
const monoBad = Object.keys(light.monoWeights).filter((w) => !["400", "500"].includes(w));

const checks = [
  ["light mode really is light (warm paper)", light.scheme === "light" && light.bodyBg === "rgb(248, 247, 244)"],
  ["dark mode really is dark (#1b1a18)", dark.scheme === "dark" && dark.bodyBg === "rgb(27, 26, 24)"],
  ["wordmark 750", light.wordmark?.weight === "750"],
  ["hero 650", light.hero?.weight === "650"],
  ["no stray sans weights", sansBad.length === 0],
  ["no stray mono weights (h3 no longer 700)", monoBad.length === 0],
  ["h3 all 500", light.h3Weights.every((w) => w === "500")],
  ["DM Sans loaded (no silent fallback)", light.dmSansLoaded === true],
  ["DM Mono loaded", light.dmMonoLoaded === true],
  ["no horizontal overflow, both modes", !light.hasOverflow && !dark.hasOverflow],
  ["verdict marks rendered", light.svgCount >= 4],
  ["all four rail labels present", light.railLabels.length === 4],
  ["rail labels are the four verdicts", ["verified", "misattributed", "fabricated", "unverifiable"].every((v) => light.railLabels.includes(v))],
  ["fabricated line is struck", light.struckCount >= 1],
  ["unverifiable has a dashed rule, not a strike", light.dashedRuleCount >= 1 && light.struckCount === 1],
  ["every rail citation fits on one line", citeLinesOk],
  ["all verdict marks align to the same rail offset", offsetsAligned],
  ["transitions killed before the read", /^0s/.test(light.transitionsKilled ?? "")],
];
let pass = 0;
console.log("\n=== ACCEPTANCE ===");
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (ok) pass++;
}
if (sansBad.length) console.log(`     stray sans weights: ${sansBad.join(", ")}`);
if (monoBad.length) console.log(`     stray mono weights: ${monoBad.join(", ")}`);
console.log(`\n  ${pass}/${checks.length} passed`);
console.log(`\nscreenshots -> ${join(OUTDIR, "light-desktop.png")}, ${join(OUTDIR, "dark-desktop.png")}`);
if (!ctlOk) { console.log("\nCONTROL FAILED — nothing above is trustworthy."); pass = 0; }

c.close();
proc.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(pass === checks.length ? 0 : 1);
