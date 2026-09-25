// Headless Chrome driver over CDP. Zero dependencies: Node 24 has fetch + WebSocket.
//
// Usage:  node .recon/driver.mjs [baseUrl] [outdir]
//
// Drives the REAL flow: it lands on `/`, fills the sample brief, runs the audit through
// `app/api/audit`, and lands on the report page. Then it looks at the result.
//
// ## Why a driver at all
//
// A class-name grep cannot see a control rendered in its own background colour, and `tsc` cannot see
// a font that silently snapped to the wrong weight. Grepping built HTML for `.btn-solid` reported
// everything fine while the primary CTA was manila-on-manila at 1.00:1 and invisible. If we have not
// looked at it, we do not know it works.
//
// ## The disciplines, each bought with a past mistake
//
//  1. PLANTED CONTROLS. A probe that cannot detect a planted failure reports a confident PASS and
//     looks identical to a working one. Every detector here plants a failure that MUST be caught and
//     a good case that MUST pass; if the controls fail, the whole run is discarded and says so.
//  2. HASHED CLASSES. CSS Modules hash class names at build time, so `.railLabel` matches NOTHING
//     and a probe silently measures the empty set. Every selector here is `[class*="..."]` or a
//     `data-ui` attribute, which is stable on purpose.
//  3. KILL TRANSITIONS before a synchronous computed-style read, or the read returns the PREVIOUS
//     frame. `.btn` transitions `color` over 150ms, so a control that sets and reads in the same tick
//     measures the frame before the change — including a planted 1:1 control, which then reads as
//     "the probe is blind" when the probe was fine and the CONTROL was lying.
//  4. STATE THE COLOUR SCHEME. Headless Chrome reports `prefers-color-scheme: dark` by default, so an
//     unqualified light-mode assertion fails against a perfectly good page.
//
// ## Two probe bugs this file is written to avoid, both of which produced confident nonsense
//
//  5. EXCLUDE YOUR OWN CONTROLS FROM YOUR OWN SAMPLE. A planted `__ctl500` counted as page content
//     made the weight census report a stray UI weight that existed only because the probe put it
//     there. Planted nodes are skipped by id prefix everywhere.
//  6. A TIMEOUT IS NOT EVIDENCE. In Git Bash, MSYS rewrites a leading `/` in a `/regex/` argument
//     into a Windows path before node sees it, so `until "/^\/report\//.test(...)"` timed out against
//     a page that HAD navigated. Never wrap a `/`-leading pattern in shell quotes: use
//     `indexOf('report/') > -1`, which has no leading slash to mangle. URL waits therefore poll
//     `location.pathname.indexOf(...)`.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.argv[2] ?? "http://localhost:3210").replace(/\/$/, "");
const OUTDIR = process.argv[3] ?? ".recon/shots";
const PORT = 9334;
const DESKTOP = { width: 1280, height: 1400 };
const PHONE = { width: 375, height: 1400 };

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
    `--window-size=${DESKTOP.width},${DESKTOP.height}`, "about:blank",
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
await c.send("DOM.enable");

const viewport = (w, h) =>
  c.send("Emulation.setDeviceMetricsOverride", {
    width: w, height: h, deviceScaleFactor: 1, mobile: w < 600,
  });
const scheme = (mode) =>
  c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] });
const reducedMotion = (on) =>
  c.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: "light" },
      { name: "prefers-reduced-motion", value: on ? "reduce" : "no-preference" },
    ],
  });

async function evaluate(expression) {
  const r = await c.send("Runtime.evaluate", { returnByValue: true, expression, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("probe threw: " + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function shoot(file, clip) {
  const shot = await c.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  writeFileSync(join(OUTDIR, file), Buffer.from(shot.data, "base64"));
}

async function goto(url) {
  const loaded = c.once("Page.loadEventFired");
  await c.send("Page.navigate", { url });
  await loaded;
  await sleep(1200); // fonts
}

/** Kills transitions before any synchronous computed-style read (discipline 3). */
async function killMotion() {
  await evaluate(`(() => {
    if (document.getElementById('__killmotion')) return;
    const s = document.createElement('style');
    s.id = '__killmotion';
    s.textContent = '*{transition:none !important}';
    document.head.appendChild(s);
  })()`);
}

/** Plants the instrument: three weights that MUST read back distinctly. */
async function plantControls() {
  await evaluate(`(() => {
    for (const w of ['550','400','500','700']) {
      if (document.getElementById('__ctl' + w)) continue;
      const e = document.createElement('span');
      e.id = '__ctl' + w;
      e.textContent = '.';
      e.style.fontWeight = w;
      document.body.appendChild(e);
    }
  })()`);
}

// --- shared probe fragments ------------------------------------------------------

const HELPERS = `
  // TWO arguments, not one. The first version was \`(el) => getComputedStyle(el)\`, and calling
  // \`cs(el, '::after')\` then silently measured the ELEMENT instead of its pseudo-element — so the
  // strike rule was reported as \`content: normal, background: rgba(0,0,0,0)\`, i.e. "the animation
  // does not exist", against CSS that was demonstrably correct and visibly rendering. That is the
  // lying-probe failure: a wrong answer delivered confidently, with no error anywhere.
  const cs = (el, pseudo) => el ? getComputedStyle(el, pseudo) : null;
  const q = (needle) => document.querySelector('[class*="' + needle + '"]');
  const qa = (needle) => [...document.querySelectorAll('[class*="' + needle + '"]')];
  const uis = (sel) => [...document.querySelectorAll(sel)];
  const planted = (el) => el.id && el.id.indexOf('__ctl') === 0;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; };
`;

/** Weight census that excludes the instrument's own planted nodes (discipline 5). */
const WEIGHT_CENSUS = `
  const census = () => {
    const sans = {}, mono = {};
    for (const el of document.querySelectorAll('*')) {
      if (planted(el)) continue;
      if (!el.textContent || !el.textContent.trim()) continue;
      const s = cs(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const w = s.fontWeight;
      if (/Mono/i.test(s.fontFamily)) mono[w] = (mono[w] || 0) + 1;
      else sans[w] = (sans[w] || 0) + 1;
    }
    return { sans, mono };
  };
`;

// --- the landing page probe ------------------------------------------------------

const LANDING_PROBE = `(() => {
  ${HELPERS}
  ${WEIGHT_CENSUS}

  // Accent FILL: the one accent moment. Measured as a computed background, so a control painted in
  // its own background colour is caught here rather than by looking plausible in a class name.
  const accentFill = 'rgb(244, 94, 56)';
  const fills = uis('*').filter((el) => !planted(el) && cs(el).backgroundColor === accentFill && cs(el).display !== 'none');

  const submit = document.querySelector('[data-ui~="audit-submit"]');
  const field = document.querySelector('textarea');
  const headings = [...document.querySelectorAll('h1,h2,h3')].map((h) => ({ tag: h.tagName, weight: cs(h).fontWeight }));

  return {
    scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    title: document.title,
    bodyBg: cs(document.body).backgroundColor,
    bodyColor: cs(document.body).color,
    // Measured on the wordmark LINK, not on the h1 that wraps it: the wrapper exists for outline
    // semantics only and deliberately resets its own typography to inherit.
    wordmark: (() => {
      const el = document.querySelector('[data-ui~="wordmark"]');
      return el ? { tag: el.tagName, text: el.textContent.trim(), weight: cs(el).fontWeight } : null;
    })(),
    // The document outline: which heading LEVELS exist, and what each is set in. A page whose first
    // heading is an h2 has no top-level heading at all, which a class-name grep cannot see.
    outline: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({
      tag: h.tagName,
      weight: cs(h).fontWeight,
      mono: /Mono/i.test(cs(h).fontFamily),
      text: h.textContent.trim().slice(0, 40),
    })),
    headings,
    legendCount: uis('[data-ui^="legend"]').length,
    legendLabels: uis('[data-ui^="legend"]').map((e) => e.querySelector('[class*="legendName"]')?.textContent.trim()),
    tallyPresent: Boolean(document.querySelector('[data-ui~="verdict-tally"]')),
    mastheadBelt: document.querySelector('[data-ui^="belt-status"]')?.dataset.ui,
    mastheadBeltText: document.querySelector('[data-ui^="belt-status"]')?.textContent.trim(),
    coverageText: document.querySelector('[data-ui~="coverage-status"]')?.textContent.trim(),

    // The primary control must be visible: its fill, its label, and the ratio between them.
    //
    // Measured with the field POPULATED, because a disabled control is deliberately styled neutral
    // and this probe used to read it while it was disabled — reporting "the button is not accented"
    // against a button that was merely empty. The driver fills the field and measures again before
    // deciding anything about the accent.
    submit: submit ? {
      text: submit.textContent.trim(),
      disabled: submit.disabled,
      bg: cs(submit).backgroundColor,
      color: cs(submit).color,
      weight: cs(submit).fontWeight,
      shadow: cs(submit).boxShadow !== 'none',
      rect: rect(submit),
    } : null,
    fieldBorder: field ? cs(field).borderTopColor : null,
    fieldPlaceholderCount: field ? field.placeholder.length : 0,

    accentFillCount: fills.length,
    accentFillTags: fills.map((el) => el.tagName + (el.getAttribute('data-ui') ? '[' + el.getAttribute('data-ui') + ']' : '')),

    // The sample control must actually be a control, not a dead span.
    sampleControl: (() => {
      const el = [...document.querySelectorAll('button')].find((b) => /use the sample brief/i.test(b.textContent));
      return el ? { tag: el.tagName, text: el.textContent.trim(), colour: cs(el).color } : null;
    })(),

    census: census(),
    dmSansLoaded: [...document.fonts].some((f) => /DM Sans/i.test(f.family) && f.status === 'loaded'),
    dmMonoLoaded: [...document.fonts].some((f) => /DM Mono/i.test(f.family) && f.status === 'loaded'),
    hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    control550: cs(document.getElementById('__ctl550')).fontWeight,
    control400: cs(document.getElementById('__ctl400')).fontWeight,
    control500: cs(document.getElementById('__ctl500')).fontWeight,
    control700: cs(document.getElementById('__ctl700')).fontWeight,
  };
})()`;

// --- the report page probe -------------------------------------------------------

const REPORT_PROBE = `(() => {
  ${HELPERS}
  ${WEIGHT_CENSUS}

  const accentFill = 'rgb(244, 94, 56)';
  const fills = uis('*').filter((el) => !planted(el) && cs(el).backgroundColor === accentFill && cs(el).display !== 'none');

  const railEntries = uis('[data-ui^="rail-entry"]');
  const quoteMarks = uis('[data-ui^="quote-mark"]');
  // The rail list entries count as findings. Selected by ELEMENT, not by a data-ui prefix: the
  // inner elements carry finding-meta and finding-source, and a prefix match on the attribute
  // counted those too — reporting 11 findings on a report with 5. That is the measurement
  // contaminating its own sample for the third time in this codebase, so it is now an element
  // selector that cannot over-match.
  const findings = uis('article[data-ui^="finding"]');

  return {
    scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    title: document.title,
    bodyBg: cs(document.body).backgroundColor,
    hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    // WHICH element overflows, not just that something does. "No horizontal scroll" is the
    // acceptance criterion, but knowing only that it failed sends you hunting through the whole
    // stylesheet; naming the offender is the difference between a check and a bug report.
    overflowCulprits: (() => {
      const limit = document.documentElement.clientWidth;
      return [...document.querySelectorAll('*')]
        .filter((el) => !planted(el))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.right > limit + 1 && r.width > 0)
        .slice(0, 6)
        .map(({ el, r }) => ({
          tag: el.tagName,
          cls: (el.className || '').toString().slice(0, 40),
          right: Math.round(r.right),
          w: Math.round(r.width),
          text: (el.textContent || '').trim().slice(0, 30),
        }));
    })(),
    headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({ tag: h.tagName, weight: cs(h).fontWeight, mono: /Mono/i.test(cs(h).fontFamily), text: h.textContent.trim().slice(0, 40) })),
    outline: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({
      tag: h.tagName,
      weight: cs(h).fontWeight,
      mono: /Mono/i.test(cs(h).fontFamily),
      text: h.textContent.trim().slice(0, 40),
    })),

    railEntries: railEntries.length,
    railLabels: railEntries.map((e) => e.querySelector('[class*="entryLabel"]')?.textContent.trim()),
    railCites: railEntries.map((e) => e.querySelector('[class*="entryCite"]')?.textContent.trim()),
    // The rail rhythm: the citation must fit ONE line, or its mark slides out of step with the rest.
    railCiteLines: railEntries.map((e) => {
      const cite = e.querySelector('[class*="entryCite"]');
      if (!cite) return null;
      const s = cs(cite);
      const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
      return { text: cite.textContent.trim(), lines: Math.round(cite.clientHeight / lh) };
    }),
    // Every rail entry's mark offset from the top of ITS OWN row must match the others.
    railMarkOffsets: railEntries.map((e) => {
      const mark = e.querySelector('[class*="entryMark"]');
      const row = e.closest('[data-ui~="brief-row"]');
      if (!mark || !row) return null;
      return Math.round(mark.getBoundingClientRect().top - row.getBoundingClientRect().top);
    }),

    quoteMarks: quoteMarks.length,
    // The struck line: measured as its decoration AND the drawn rule, because either alone could be
    // missing while the other carries the mark.
    struck: uis('[class*="markFabricated"]').map((el) => ({
      decoration: cs(el).textDecorationLine,
      rule: (() => { const s = cs(el, '::after'); return s ? { content: s.content, bg: s.backgroundColor, duration: s.animationDuration } : null; })(),
      text: el.textContent.trim().slice(0, 48),
    })),
    unverifiable: uis('[class*="markUnverifiable"]').map((el) => ({
      decoration: cs(el).textDecorationLine,
      style: cs(el).textDecorationStyle,
      colour: cs(el).textDecorationColor,
      text: el.textContent.trim().slice(0, 48),
    })),

    findings: findings.length,
    verdicts: findings.map((f) => (f.getAttribute('data-ui') || '').replace('finding ', '')),
    findingLabels: findings.map((f) => f.querySelector('[class*="findingLabel"]')?.textContent.trim()),
    // The BRIEF's rail holds the citation as the DRAFTER wrote it — "347 U.S. 483, 495 (1954)" — not
    // the short coordinate, so at 168px it wraps, and it wraps uniformly: measured, every one of the
    // five is two lines. Rhythm is therefore NOT "one line each"; it is that every mark sits at the
    // same offset regardless, which is the check below. What must never happen is a citation that
    // OVERFLOWS or is clipped, because a citation the reader cannot read is not a receipt.
    briefRailCites: qa('entryCite').map((e) => {
      const s = cs(e);
      const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
      return {
        text: e.textContent.trim(),
        lines: Math.round(e.clientHeight / lh),
        overflow: e.scrollWidth - e.clientWidth,
      };
    }),
    excerpts: uis('[data-ui~="excerpt"]').length,
    excerptMarks: uis('[class*="excerptMark"]').length,
    traces: uis('[data-ui~="resolution-trace"]').length,
    trueHomes: uis('[data-ui~="true-home"]').length,
    candidates: uis('[data-ui~="true-home-candidates"] li').length,
    // A prefix match on "belt " with a trailing space, NOT on "belt". A plain prefix match also
    // matched the MASTHEAD's "belt-status deterministic-only" fact, so this selector reported one
    // belt section on a report where none ran — a false pass on the one check that proves the belt
    // cannot move a verdict.
    belts: uis('[data-ui^="belt "]').map((b) => b.getAttribute('data-ui')),
    capNotice: Boolean(document.querySelector('[data-ui~="capped-notice"]')),
    emptyState: Boolean(document.querySelector('[data-ui~="empty-state"]')),
    headline: document.querySelector('[data-ui~="headline"]')?.textContent.trim(),
    tallyCells: uis('[data-ui^="tally-cell"]').map((e) => e.getAttribute('data-ui').replace('tally-cell ', '')),
    colophon: document.querySelector('[data-ui~="colophon"]')?.textContent.slice(0, 120),

    // Source links must be real anchors, and the label must say which KIND of link it is.
    sourceLinks: uis('[data-ui~="finding-source"] a').map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() })),

    accentFillCount: fills.length,
    accentFillTags: fills.map((el) => el.tagName + (el.getAttribute('data-ui') ? '[' + el.getAttribute('data-ui') + ']' : '')),

    census: census(),
    dmSansLoaded: [...document.fonts].some((f) => /DM Sans/i.test(f.family) && f.status === 'loaded'),
    dmMonoLoaded: [...document.fonts].some((f) => /DM Mono/i.test(f.family) && f.status === 'loaded'),
    control550: cs(document.getElementById('__ctl550')).fontWeight,
    control400: cs(document.getElementById('__ctl400')).fontWeight,
    control500: cs(document.getElementById('__ctl500')).fontWeight,
    control700: cs(document.getElementById('__ctl700')).fontWeight,
  };
})()`;

// --- tab focus order -------------------------------------------------------------
//
// Tab is dispatched as a real key event rather than simulated with `el.focus()`, because
// `:focus-visible` — which is what this design uses to draw the focus ring — only applies when focus
// arrived from the keyboard. A probe that calls `focus()` measures a ring the user will never see.

async function tabOrder(limit) {
  const steps = [];
  await evaluate(`document.body.focus(); if (document.activeElement !== document.body) document.activeElement.blur();`);
  for (let i = 0; i < limit; i++) {
    await c.send("Input.dispatchKeyEvent", {
      type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9,
    });
    await c.send("Input.dispatchKeyEvent", {
      type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9,
    });
    const step = await evaluate(`(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const matches = el.matches(':focus-visible');
      return {
        tag: el.tagName,
        ui: el.getAttribute('data-ui'),
        text: (el.textContent || '').trim().slice(0, 40) || el.getAttribute('aria-label') || el.placeholder?.slice(0, 40) || null,
        outlineWidth: s.outlineWidth,
        outlineStyle: s.outlineStyle,
        outlineColor: s.outlineColor,
        focusVisible: matches,
      };
    })()`);
    if (!step) break;
    const key = `${step.tag}|${step.ui}|${step.text}`;
    if (steps.some((s) => s.key === key)) break; // wrapped around to the top
    steps.push({ key, ...step });
  }
  return steps;
}

// --- main ------------------------------------------------------------------------

console.log(`chrome: ${bin}`);
console.log(`target: ${BASE}\n`);

await viewport(DESKTOP.width, DESKTOP.height);
await scheme("light");
await goto(`${BASE}/`);
await plantControls();
await killMotion();

await sleep(400);
const landing = await evaluate(LANDING_PROBE);
await shoot("landing-light.png");

// The tab order, measured on the real page before anything is clicked.
const landingTabs = await tabOrder(12);

await reducedMotion(true);
const reduced = await evaluate(`(() => {
  const struck = document.querySelector('[class*="markFabricated"]');
  const s = struck ? getComputedStyle(struck, '::after') : null;
  const anyTransition = [...document.querySelectorAll('*')]
    .map((el) => getComputedStyle(el).transitionDuration)
    .filter((d) => d && d !== '0s' && !/^0(\.0+)?s(,|$)/.test(d));
  return {
    mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    strikeDuration: s ? s.animationDuration : null,
    strikeStillDrawn: s ? s.backgroundColor !== 'rgba(0, 0, 0, 0)' : null,
    liveTransitions: anyTransition.length,
  };
})()`);

// Back to no-preference for the screenshots.
await reducedMotion(false);
await sleep(300);

// --- run the audit through the real flow -----------------------------------------
//
// The belt is unchecked: it is the only component that costs money and the only one that can be rate
// limited, and this probe is about the UI rather than about the model. The belt's own rendering is
// covered by the live run recorded separately.

await evaluate(`(() => {
  const sample = [...document.querySelectorAll('button')].find((b) => /use the sample brief/i.test(b.textContent));
  if (!sample) return 'NO SAMPLE CONTROL';
  sample.click();
  return 'clicked';
})()`);
await sleep(500);

const filled = await evaluate(`(() => {
  const f = document.querySelector('textarea');
  return { chars: f.value.length, firstLine: f.value.split('\\n')[0] };
})()`);
console.log(`sample brief loaded into the field: ${filled.chars} chars — "${filled.firstLine}"`);

const toggled = await evaluate(`(() => {
  const box = document.querySelector('[data-ui~="belt-toggle"] input[type=checkbox]');
  if (!box) return 'NO TOGGLE';
  if (box.checked) box.click();
  return { checked: box.checked };
})()`);
console.log(`belt toggle: ${JSON.stringify(toggled)}`);

const shotBeforeSubmit = await evaluate(`(() => {
  const b = document.querySelector('[data-ui~="audit-submit"]');
  return { disabled: b.disabled, text: b.textContent.trim() };
})()`);
await shoot("landing-filled.png");

// The control is measured AGAIN, now that the field has content and the button is live: everything
// about its accent, its shadow and its enabled state is only true of the enabled button.
const filledLanding = await evaluate(LANDING_PROBE);

console.log(`submitting: ${JSON.stringify(shotBeforeSubmit)}`);
await evaluate(`document.querySelector('[data-ui~="audit-submit"]').click()`);

// Poll for the navigation. `indexOf`, never a leading-slash regex (discipline 6).
let reportPath = null;
for (let i = 0; i < 240; i++) {
  const p = await evaluate(`location.pathname`);
  if (p && p.indexOf("report/") > -1) { reportPath = p; break; }
  const err = await evaluate(`document.querySelector('[data-ui~="form-error"]')?.textContent ?? null`);
  if (err) { console.error(`\nAUDIT FAILED: ${err}`); proc.kill(); process.exit(1); }
  await sleep(500);
}
if (!reportPath) {
  console.error("\nThe audit never navigated to a report within 120s.");
  proc.kill();
  process.exit(1);
}
console.log(`report: ${reportPath}\n`);

// NO `Page.loadEventFired` wait here, and that is a deliberate correction. `router.push` is a
// client-side navigation, so no page load event is emitted — waiting for one hung the driver
// indefinitely against a report page that had already rendered. (The first version of this file
// did exactly that, and the symptom was a driver that produced two screenshots and then stopped
// with no error.) The page is server-rendered and the payload has already arrived by the time the
// pathname changed, so settle on fonts instead of on a load event.
await evaluate(`document.fonts.ready.then(() => true)`);
await sleep(700);
await plantControls();
await killMotion();
await sleep(400);

const report = await evaluate(REPORT_PROBE);
await shoot("report-light.png");

// The UNVERIFIABLE row, specifically — the acceptance asks for it by name.
const unverifClip = await evaluate(`(() => {
  ${HELPERS}
  const f = document.querySelector('[data-ui~="finding"][data-ui*="UNVERIFIABLE"]');
  if (!f) return null;
  f.scrollIntoView({ block: 'center' });
  return rect(f);
})()`);
if (unverifClip) {
  await sleep(400);
  await shoot("report-unverifiable.png", {
    x: Math.max(0, unverifClip.left - 16),
    y: Math.max(0, unverifClip.top - 16),
    width: Math.min(DESKTOP.width, unverifClip.w + 32),
    height: unverifClip.h + 32,
  });
}

const reportTabs = await tabOrder(12);

// --- reduced motion, ON THE PAGE THAT HAS THE ANIMATION ---------------------------
//
// The earlier version of this measured the REFERENCE case on the landing page, which contains no
// strike rule at all, so `strikeDuration === null` passed for the wrong reason: nothing was animated
// because nothing existed to animate. The claim is about the report page, so it is measured there,
// and it is a THREE-part check — the animation stops, nothing else animates, and the mark itself is
// still drawn (a reduced-motion rule that deleted the strike would remove the finding, not the
// motion).

await reducedMotion(true);
await sleep(400);
const reportReduced = await evaluate(`(() => {
  ${HELPERS}
  const struck = document.querySelector('[class*="markFabricated"]');
  const rule = struck ? cs(struck, '::after') : null;
  const live = [...document.querySelectorAll('*')]
    .filter((el) => !planted(el))
    .map((el) => cs(el))
    .filter((s) => s.transitionDuration && !/^(0s|0\.0*s|0\.0*0*1s)(,|$)/.test(s.transitionDuration));
  return {
    mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    strikeFound: Boolean(struck),
    strikeDuration: rule ? rule.animationDuration : null,
    strikeStillDrawn: rule ? rule.backgroundColor === 'rgb(176, 42, 31)' : null,
    decorationIntact: struck ? cs(struck).textDecorationLine.includes('line-through') : null,
    liveTransitions: live.length,
  };
})()`);
await reducedMotion(false);
await sleep(300);

// --- dark mode --------------------------------------------------------------------

await evaluate(`window.scrollTo(0, 0)`);
await scheme("dark");
await sleep(400);
await shoot("report-dark.png");
const reportDark = await evaluate(REPORT_PROBE);

await goto(`${BASE}/`);
await plantControls();
await killMotion();
await scheme("dark");
await sleep(400);
const landingDark = await evaluate(LANDING_PROBE);
await shoot("landing-dark.png");

// --- phone width: the rail must not squeeze the text or scroll sideways -----------

await scheme("light");
await viewport(PHONE.width, PHONE.height);
await sleep(500);
const phoneLanding = await evaluate(LANDING_PROBE);
await shoot("landing-375.png");

await goto(`${BASE}${reportPath}`);
await plantControls();
await killMotion();
await sleep(500);
const phoneReport = await evaluate(REPORT_PROBE);
await shoot("report-375.png");

// --- adjudication -----------------------------------------------------------------

const rows = [];
const check = (label, ok, detail = "") => rows.push({ label, ok: Boolean(ok), detail });

console.log("================ LANDING PAGE ================");
console.log(`  scheme / bg:            ${landing.scheme} / ${landing.bodyBg}`);
console.log(`  wordmark:               ${landing.wordmark?.weight} on <${landing.wordmark?.tag}>   (design: 750 on the wordmark)`);
console.log(`  heading outline:        ${JSON.stringify(landing.outline)}`);
console.log(`  legend entries:         ${landing.legendCount}  ${JSON.stringify(landing.legendLabels)}`);
console.log(`  legend headings:        ${landing.legendHeadings === undefined ? "(see outline)" : JSON.stringify(landing.legendHeadings)}`);
console.log(`  sans / mono weights:    ${JSON.stringify(landing.census.sans)} / ${JSON.stringify(landing.census.mono)}`);
console.log(`  DM Sans / DM Mono:      ${landing.dmSansLoaded} / ${landing.dmMonoLoaded}`);
console.log(`  overflow @1280:         ${landing.hasOverflow ? "YES " + landing.scrollW + ">" + landing.clientW : "no"}`);
console.log("");

console.log("================ REPORT PAGE =================");
console.log(`  title:                  ${report.title}`);
console.log(`  headline:               ${report.headline}`);
console.log(`  findings:               ${report.findings}  ${JSON.stringify(report.verdicts)}`);
console.log(`  finding labels:         ${JSON.stringify(report.findingLabels)}`);
console.log(`  brief rail cites:       ${JSON.stringify(report.railCites)}`);
console.log(`  brief rail line counts: ${JSON.stringify(report.briefRailCites.map((r) => r.lines))}`);
console.log(`  brief rail mark offsets:${JSON.stringify(report.railMarkOffsets)}`);
console.log(`  quote marks:            ${report.quoteMarks}`);
console.log(`  struck:                 ${JSON.stringify(report.struck)}`);
console.log(`  unverifiable marks:     ${JSON.stringify(report.unverifiable)}`);
console.log(`  excerpts / marks:       ${report.excerpts} / ${report.excerptMarks}`);
console.log(`  true homes / losers:    ${report.trueHomes} / ${report.candidates}`);
console.log(`  traces:                 ${report.traces}`);
console.log(`  belt sections:          ${JSON.stringify(report.belts)}`);
console.log(`  cap notice / empty:     ${report.capNotice} / ${report.emptyState}`);
console.log(`  tally cells:            ${JSON.stringify(report.tallyCells)}`);
console.log(`  source links:           ${JSON.stringify(report.sourceLinks)}`);
console.log(`  accent FILL elements:   ${report.accentFillCount}  ${JSON.stringify(report.accentFillTags)}`);
console.log(`  heading outline:        ${JSON.stringify(report.outline)}`);
console.log(`  sans / mono weights:    ${JSON.stringify(report.census.sans)} / ${JSON.stringify(report.census.mono)}`);
console.log(`  overflow @1280:         ${report.hasOverflow ? "YES " + report.scrollW + ">" + report.clientW : "no"}`);
console.log("");

// --- control adjudication ---------------------------------------------------------

console.log("================ CONTROL ADJUDICATION ================");
console.log("  A blind probe reports a confident PASS, so the instrument is tested first.");
const controlsOk =
  landing.control550 === "550" && landing.control400 === "400" &&
  landing.control500 === "500" && landing.control700 === "700" &&
  report.control550 === "550" && report.control700 === "700";
console.log(`  planted 550/400/500/700 read back as ${landing.control550}/${landing.control400}/${landing.control500}/${landing.control700}`);
console.log(`  probe can separate all four weights: ${controlsOk ? "YES" : "NO — PROBE IS BLIND"}`);

// The planted 1:1 control: a control painted in its own background colour MUST be caught by the
// accent-fill measurement, and the probe must be able to see it.
const blindTest = await evaluate(`(() => {
  ${HELPERS}
  const probe = document.createElement('div');
  probe.id = '__probe1to1';
  probe.textContent = 'planted';
  probe.style.cssText = 'background:rgb(255,254,250);color:rgb(255,254,250);padding:4px';
  document.body.appendChild(probe);
  const s = cs(probe);
  const invisible = s.backgroundColor === s.color;
  probe.remove();
  return { invisible, canReadBoth: Boolean(s.backgroundColor && s.color) };
})()`);
console.log(`  planted same-colour control reads bg===fg: ${blindTest.invisible} (must be true)`);
const controlsBlind = !controlsOk || !blindTest.invisible;

// --- acceptance -------------------------------------------------------------------

const straightWeights = (census) => Object.keys(census.sans).every((w) => ["400", "550", "650", "750"].includes(w));
const monoWeightsOk = (census) => Object.keys(census.mono).every((w) => ["400", "500"].includes(w));

/**
 * The wordmark's `h1` wrapper inherits the wordmark's own weight (750), because the wrapper and the
 * link are the same typographic object. So 750 is on-spec for an H1 here, and the check tolerates it
 * rather than demanding 550 of a heading that is deliberately not set in the UI weight.
 */
const headingOnSpec = (outline) =>
  outline.length > 0 &&
  outline.every((h) => (h.mono ? ["400", "500"].includes(h.weight) : ["550", "650", "750"].includes(h.weight)));

/** Every heading LEVEL that exists must still be a sans heading, not a mono one. */
const topLevelIsSans = (outline) => {
  const h1 = outline.find((h) => h.tag === "H1");
  return Boolean(h1) && !h1.mono;
};

check("light mode is warm paper", landing.scheme === "light" && landing.bodyBg === "rgb(248, 247, 244)");
check("dark mode is warm dark", reportDark.scheme === "dark" && reportDark.bodyBg === "rgb(27, 26, 24)");
check("wordmark is 750 (the design's wordmark step, not the hero's 650)", landing.wordmark?.weight === "750");
check("every heading states an on-spec weight", headingOnSpec(landing.outline) && headingOnSpec(report.outline), JSON.stringify([...landing.outline, ...report.outline]));
check("the page has a top-level heading", topLevelIsSans(landing.outline) && topLevelIsSans(report.outline), JSON.stringify([...landing.outline, ...report.outline].filter((h) => h.tag === "H1")));
check("no stray sans weights", straightWeights(landing.census) && straightWeights(report.census));
check("no stray mono weights", monoWeightsOk(landing.census) && monoWeightsOk(report.census));
check("DM Sans Variable loaded (no silent 550 snap)", landing.dmSansLoaded && report.dmSansLoaded);
check("DM Mono loaded", landing.dmMonoLoaded && report.dmMonoLoaded);

check("exactly ONE accent fill on the landing page", filledLanding.accentFillCount === 1, JSON.stringify(filledLanding.accentFillTags));
check("the accent fill IS the audit control", (filledLanding.accentFillTags[0] ?? "").includes("audit-submit"));
check("no accent fill on the report page (the report does not shout)", report.accentFillCount === 0, JSON.stringify(report.accentFillTags));
check("primary control is visible: fill !== label colour", filledLanding.submit && filledLanding.submit.bg !== filledLanding.submit.color, `${filledLanding.submit?.bg} vs ${filledLanding.submit?.color}`);
check("primary control carries the accent, not a neutral", filledLanding.submit?.bg === "rgb(244, 94, 56)", String(filledLanding.submit?.bg));
check("primary control is ENABLED once the field has content", filledLanding.submit?.disabled === false);
check("primary control has the key shadow", filledLanding.submit?.shadow === true);
check("sample control is a real <button>", landing.sampleControl?.tag === "BUTTON");

check("all six verdicts are explained on the landing page", landing.legendCount === 6, JSON.stringify(landing.legendLabels));
check("the masthead states the belt and the corpus boundary", Boolean(landing.mastheadBeltText) && Boolean(landing.coverageText), `${landing.mastheadBeltText} | ${landing.coverageText}`);

check("audit reached the report page", Boolean(reportPath));
check("the report is titled with the DOCUMENT's own name, not the docket line", report.title.startsWith("DEFENDANT'S MOTION TO DISMISS"), report.title);
check("every audited item has a rail entry and a finding", report.railEntries === report.findings && report.railEntries > 0, `${report.railEntries} rail / ${report.findings} findings`);
check("findings carry the five ground-truth verdicts", JSON.stringify(report.verdicts) === JSON.stringify(["VERIFIED", "MISATTRIBUTED", "FABRICATED", "UNVERIFIABLE_COVERAGE", "UNVERIFIABLE_LOW_CONFIDENCE"]), JSON.stringify(report.verdicts));
check("every rail citation stays inside its column (nothing clipped)", report.briefRailCites.length > 0 && report.briefRailCites.every((r) => r.overflow <= 1), JSON.stringify(report.briefRailCites.map((r) => `${r.text.slice(0, 22)}: over ${r.overflow}px`)));
check("the rail wraps uniformly, so no mark slides out of step", new Set(report.briefRailCites.map((r) => r.lines)).size === 1, JSON.stringify(report.briefRailCites.map((r) => r.lines)));
const offsets = report.railMarkOffsets.filter((o) => o !== null);
check("all brief rail marks align to the same offset", offsets.length > 1 && new Set(offsets).size === 1, JSON.stringify(offsets));
check("the quotation marks are drawn in the document", report.quoteMarks >= 4, String(report.quoteMarks));
// The strike: the decorated line AND the drawn rule must BOTH be present, because either alone
// carries the mark while the other is silently missing. Measured now via the two-argument helper.
check("the fabricated line is struck: decoration AND drawn rule", report.struck.length === 1 && report.struck[0].decoration.includes("line-through") && report.struck[0].rule?.bg === "rgb(176, 42, 31)", JSON.stringify(report.struck[0]));
check("the strike rule is the page's only animation, 180ms", report.struck[0]?.rule?.duration === "0.18s", String(report.struck[0]?.rule?.duration));
check("the unverifiable quotation is dotted, not struck", report.unverifiable.length >= 1 && report.unverifiable.every((u) => u.style === "dotted" && !u.decoration.includes("line-through")), JSON.stringify(report.unverifiable));
check("the unverifiable mark is NOT the unstyled line tone", report.unverifiable.every((u) => u.colour !== "rgb(207, 206, 198)"), JSON.stringify(report.unverifiable.map((u) => u.colour)));
check("excerpts render the opinion's own bytes", report.excerpts >= 2 && report.excerptMarks >= 2, `${report.excerpts} / ${report.excerptMarks}`);
check("the misattributed line names a true home", report.trueHomes === 1);
// The list holds the QUOTERS THAT LOST — the true home is rendered above it — so a non-empty list is
// the evidence that the ranking is visible. Measured on the fixture brief: the true home plus one
// losing quoter (McCauley v. City of Chicago), so exactly one row here is correct, and demanding more
// than one failed a correct page.
check("the losing quoters are shown, not hidden", report.candidates >= 1, `${report.candidates} ranked loser(s)`);
check("the fabricated line shows a resolution trace", report.traces >= 1);
check("no belt section renders when the belt did not run", report.belts.length === 0, JSON.stringify(report.belts));
check("source links are real anchors with a labelled kind", report.sourceLinks.length >= 2 && report.sourceLinks.every((l) => l.href.startsWith("http")), JSON.stringify(report.sourceLinks.slice(0, 2)));
check("the headline summarises the same counts the tally shows", Boolean(report.headline) && report.headline.includes(String(report.findings)), report.headline);
check("the tally shows all six verdicts, zeros included", report.tallyCells.length === 6, JSON.stringify(report.tallyCells));

check("no horizontal overflow at 1280 (both modes)", !landing.hasOverflow && !report.hasOverflow && !reportDark.hasOverflow);
check("no horizontal overflow at 375, landing", !phoneLanding.hasOverflow, `${phoneLanding.scrollW} vs ${phoneLanding.clientW} — ${JSON.stringify(phoneLanding.overflowCulprits)}`);
check("no horizontal overflow at 375, report", !phoneReport.hasOverflow, `${phoneReport.scrollW} vs ${phoneReport.clientW} — ${JSON.stringify(phoneReport.overflowCulprits)}`);
check("the rail survives at 375 without squeezing the text", phoneReport.railEntries === report.railEntries, `${phoneReport.railEntries} vs ${report.railEntries}`);

check("tab focus lands on real controls", landingTabs.length >= 3, `${landingTabs.length} stops: ${landingTabs.map((t) => t.tag).join(" > ")}`);
check("EVERY tab stop draws a visible focus ring", landingTabs.length > 0 && landingTabs.every((t) => t.focusVisible && t.outlineStyle !== "none" && parseFloat(t.outlineWidth) >= 2), JSON.stringify(landingTabs.map((t) => `${t.tag}: w=${t.outlineWidth} style=${t.outlineStyle} focusVisible=${t.focusVisible}`)));
check("the report page is keyboard reachable", reportTabs.length >= 2, `${reportTabs.length} stops`);

check("prefers-reduced-motion is honoured by the page", reduced.mediaMatches === true);
check("reduced motion leaves no live transition anywhere", reduced.liveTransitions === 0, `${reduced.liveTransitions} elements still transition`);
// `1e-05s`, not `0s`. Chrome serialises the reduced-motion `0.01ms` override in scientific notation,
// and the first version of this asserted the literal string "0s" — failing a rule that was working
// exactly as written. Match the numeric value, never the serialisation.
const strikeIsInert = (d) => {
  const seconds = parseFloat(d);
  return Number.isFinite(seconds) ? seconds <= 0.001 : d === "0s";
};
check("reduced motion stops the strike animation ON the report page", reportReduced.strikeFound === true && strikeIsInert(reportReduced.strikeDuration), `${reportReduced.strikeDuration} (found: ${reportReduced.strikeFound})`);
check("reduced motion still DRAWS the strike (the mark is not lost)", reportReduced.strikeStillDrawn === true && reportReduced.decorationIntact === true);
check("reduced motion leaves no live transition on the report page", reportReduced.liveTransitions === 0, `${reportReduced.liveTransitions} elements still transition`);

// --- report -----------------------------------------------------------------------

let pass = 0;
console.log("\n================ ACCEPTANCE ================");
for (const r of rows) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.detail && !r.ok ? "   → " + r.detail : ""}`);
  if (r.ok) pass++;
}
console.log(`\n  ${pass}/${rows.length} passed`);

console.log("\n================ TAB ORDER ================");
for (const [i, t] of landingTabs.entries()) {
  console.log(`  ${i + 1}. ${t.tag}${t.ui ? " [" + t.ui + "]" : ""} — ${t.text ?? "(no text)"}  outline ${t.outlineWidth} ${t.outlineStyle}${t.focusVisible ? "" : "  (NOT :focus-visible)"}`);
}

console.log(`\nscreenshots -> ${OUTDIR}`);
console.log("  landing-light.png  landing-dark.png  landing-filled.png  landing-375.png");
console.log("  report-light.png   report-dark.png   report-unverifiable.png  report-375.png");

if (controlsBlind) {
  console.log("\n*** CONTROL FAILED — the instrument is blind. Nothing above is trustworthy. ***");
  pass = 0;
}

c.close();
proc.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
// `process.exitCode`, NOT `process.exit()`. Writing to a pipe or a file makes stdout ASYNC in Node,
// and `process.exit()` tears the process down without waiting for those writes to drain — so
// `node .recon/driver.mjs > report.txt` produced a file containing one line and nothing else, while
// the identical run through a TTY printed everything. A verification tool that silently discards its
// own evidence is the failure mode this whole file exists to avoid, so the exit is deferred and Node
// is left to flush. (Earlier runs only looked fine because they were piped through `tail`, which
// keeps the write end open long enough for the buffer to drain.)
process.exitCode = pass === rows.length && !controlsBlind ? 0 : 1;
