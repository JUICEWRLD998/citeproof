# CiteProof — the design system, and the numbers behind it

**Direction: "Annotated Brief".** The subject is a legal brief under audit — paper, ink, a margin,
and marks in that margin. So the vocabulary is the annotated brief, derived from the subject rather
than from a tech aesthetic. Base grammar: the warm paper-and-ink language (`warm-calm-ui`), extended
with a bounded semantic verdict layer rather than applied blindly.

**Explicitly rejected** — these are the traps for this brief, not generic advice:
terminal / CRT / neon (the default trap for any hacking-or-forensics brief) · near-black plus one acid
accent · violet-indigo glass · gradient cards · centred hero with three feature cards and a gradient
CTA · emoji as icons.

Every ratio in this document is produced by `node .recon/contrast.mjs`, which **parses
`styles/tokens.css`** and verifies the values the build actually ships. Reproduce with that command;
do not copy the numbers forward.

---

## 1. Why the checker reads the stylesheet

The first version kept its own table of hex values and solved for compliant ones, printing a
"current" column and a "solved" column. `styles/tokens.css` then adopted the solved values, and the
tool kept reporting the *old* ones as current — `muted #777970 4.12:1` while the file shipped
`#6f7169`. Nothing failed. **A palette check that reads a transcription of the palette verifies the
transcription.** It now parses the stylesheet, and the two can no longer disagree.

It also now fails loudly on a value that has been renamed or removed, because a pair naming a token
that no longer exists would compare `undefined` against a target and could print a pass.

---

## 2. Light mode — 24 foreground/background pairs

Targets are WCAG 2.1: **4.5** normal text AA · **3.0** large text AA and non-text UI components
(1.4.11). Body ink is held at **7.0** because it is free to hold it there.

| Foreground | On | Value | Ratio | Target | Where it is used |
|---|---|---|---|---|---|
| ink | paper | `#292a26` on `#f8f7f4` | **13.49:1** | 7.0 | body text |
| ink | surface | `#292a26` on `#fffefa` | **14.32:1** | 7.0 | document text, true-home name, belt text |
| muted | paper | `#6f7169` on `#f8f7f4` | **4.62:1** | 4.5 | secondary prose, excerpts, meta |
| muted | surface | `#6f7169` on `#fffefa` | **4.91:1** | 4.5 | rail citation, legend copy, tally label |
| faint | paper | `#8d8e81` on `#f8f7f4` | **3.10:1** | 3.0 | section labels, colophon head |
| faint | surface | `#8d8e81` on `#fffefa` | **3.29:1** | 3.0 | field label, excerpt caption, rank note |
| accent-ink | paper | `#d4340c` on `#f8f7f4` | **4.56:1** | 4.5 | links in prose |
| accent-ink | surface | `#d4340c` on `#fffefa` | **4.84:1** | 4.5 | wordmark hover, sample control, source link |
| accent-ink-hover | paper | `#ab2a08` on `#f8f7f4` | **6.39:1** | 4.5 | link hover |
| on-accent | accent | `#3e2118` on `#f45e38` | **4.53:1** | 4.5 | primary button label |
| on-accent | accent-hover | `#3e2118` on `#f37954` | **5.35:1** | 4.5 | primary button label, hovered |
| accent | surface | `#f45e38` on `#fffefa` | **3.20:1** | 3.0 | button fill (non-text) |
| accent | paper | `#f45e38` on `#f8f7f4` | **3.01:1** | 3.0 | focus ring, field border (non-text) |
| verified | paper | `#2f6b4f` on `#f8f7f4` | **5.87:1** | 4.5 | verified mark in prose |
| misattributed | paper | `#a36200` on `#f8f7f4` | **4.55:1** | 4.5 | misattributed mark in prose |
| fabricated | paper | `#b02a1f` on `#f8f7f4` | **6.13:1** | 4.5 | fabricated mark, error rule |
| verified | surface | `#2f6b4f` on `#fffefa` | **6.24:1** | 4.5 | verified mark in legend / rail / tally |
| misattributed | surface | `#a36200` on `#fffefa` | **4.83:1** | 4.5 | misattributed mark in legend / rail / tally |
| fabricated | surface | `#b02a1f` on `#fffefa` | **6.51:1** | 4.5 | fabricated mark in legend / rail / tally |
| muted | surface | `#6f7169` on `#fffefa` | **4.91:1** | 4.5 | **unverifiable** mark and label |
| fabricated | surface | `#b02a1f` on `#fffefa` | **6.51:1** | 4.5 | unsupported-belt dot |
| verified | surface | `#2f6b4f` on `#fffefa` | **6.24:1** | 4.5 | supported-belt dot |
| line-strong | paper | `#8d8b79` on `#f8f7f4` | **3.21:1** | 3.0 | field border, disabled control border |
| line-strong | surface | `#8d8b79` on `#fffefa` | **3.41:1** | 3.0 | same border on a panel |

`node .recon/contrast.mjs` also runs the dark-mode set, and the same 24 pairs pass there against
`--paper: #1b1a18`.

---

## 3. Two corrections this table forced

### 3.1 There is no `--surface-sunken`, because it could not carry its own text

A tint below `--paper` was used for the true-home panel, the belt block and the candidate rows. At
`#f2f1ec` it measured **`--muted` 4.38:1** (needs 4.5), **`--faint` 2.94:1** (needs 3.0) and
**`--accent-ink` 4.32:1** (needs 4.5) — three silent failures under every word set on it.

`--paper` is already near the top of the range, so there is very little room to darken before text
starts losing contrast. Panels therefore go the **other** way: `--surface` is *lighter* than paper,
which raises contrast instead of eating it. The token is gone, and a new background tone must now be
measured before any text lands on it.

### 3.2 The unverifiable underline was a hairline, and hairline tones cannot clear 3:1

`UNVERIFIABLE` drew its dotted underline in `--line-strong`, which measured **1.47:1** against paper.
An underline that is the only thing distinguishing one verdict state from another is a non-text UI
component under WCAG 1.4.11 and needs 3:1. It now uses `--muted` (4.62:1).

That also unified the mark: underline, glyph and label are all one quiet value. A quieter ink was not
an option — the refusal is supposed to be the quietest thing on the page, and making it fainter would
have made it unreadable rather than quiet.

`--line` (1.22:1) stays for hairlines between blocks, which the spec exempts. The exemption is
**printed by the checker** rather than left off silently, so it cannot be mistaken for an oversight.

### 3.3 `--line-strong` was re-solved, not just reassigned

Once it had to carry a 3:1 boundary, `#cfcec6` (1.47:1) was solved downward in HSL, preserving hue and
saturation, to `#8d8b79` — **3.21:1** on paper, **3.41:1** on the panel. Dark mode went to `#767166`
(**3.58:1**). The warm cast survives the correction.

---

## 4. The two invariants a contrast ratio cannot express

A WCAG ratio measures legibility against a **background**. It says nothing about whether two colours
look different, and nothing about quietness. Using it for either produced a wrong verdict here.

### 4.1 "Are these two marks different?" → CIE Lab ΔE76

`verified vs fabricated` scores **1.04:1** by ratio, which reads as "nearly identical" and is
meaningless — green and red can share a luminance and still be obviously distinct. ΔE76 for the same
pair is **65.8**. Two other pairs:

| Pair | ΔE76 | What the ratio would have said |
|---|---|---|
| verified vs misattributed | **72.6** | 1.29:1 |
| verified vs fabricated | **65.8** | 1.04:1 |
| misattributed vs fabricated | **59.7** | 1.35:1 |

That 1.04 nearly caused a working palette to be rebuilt.

### 4.2 "Which mark is quietest?" → chroma, not luminance

The refusal wins by carrying **no hue at all**: chroma **3.2** against 23.5–73.4 for the three marks
above it — **7.4× to 23.1× quieter** — while still reading at 4.62:1. By ratio it looks *louder* than
an accusation, because a valid mid-grey out-contrasts a valid muted amber. The instrument was fine
and the metric was wrong.

---

## 5. Colour is never the sole signal

Every verdict renders a **drawn inline SVG glyph** *and* a **text label**, and body copy never takes a
hue. The palette reinforces; the form carries. The report is therefore fully readable in greyscale, in
print, and under any form of colour-vision deficiency.

Each mark is a distinct **shape**, not a recoloured circle:

| Verdict | Glyph | Mark in the document |
|---|---|---|
| VERIFIED | ring + check | solid underline |
| MISATTRIBUTED | ring + arrow leaving the frame | dashed underline |
| FABRICATED | ring + cross | strikethrough + drawn rule |
| UNVERIFIABLE (all three) | dashed ring, three interiors | dotted underline |

The three refusals share a form and differ in **label** and **interior** (`out of coverage` stops a
rule, `low OCR confidence` is three shrinking dots, `unresolved` is a dash). They are not extra
colours — extra hues would make the honesty layer shout, which is the opposite of its job.

---

## 6. Type

**DM Sans Variable is mandatory.** The design's signature UI weight is **550**, which a static face
snaps to 500 or 600 with **no error anywhere**. `app/layout.tsx` passes no `weight` to `next/font`,
which selects the variable face; `app/globals.css` sets `font-synthesis-weight: none`; and
`.recon/driver.mjs` asserts the computed weight is 550, because a silent snap is invisible.

| Role | Weight | Why |
|---|---|---|
| body | 400 | |
| UI, headings, buttons | **550** | the signature weight; needs the variable face |
| hero (`h2`) | 650 | |
| wordmark | 750 | the design language's wordmark step, reserved for the product's own name |
| mono micro-labels | 500 | **DM Mono ships 400/500 only** — asking for 550 would make the browser synthesise a weight that does not exist |

Headings state their size but not their weight, so the UA default of **700** applied to every `h3`
until `app/globals.css` set the default once for `h1`–`h6`. Measured: an `h3` with no declared weight
rendered at 700.

**Mono is earned, not decorative.** Reporter citations (`347 U.S. 483`) are a formal notation, so mono
is confined to citation spans and micro-labels. Micro text gets **positive** tracking (+0.55px);
negative tracking belongs to large type only.

---

## 7. Structure

- **The margin rail is the one boldness**, spent once per screen. The document is the hero, not the
  tool: a left column holding the reporter citation, a hairline rule, and the verdict mark, so the
  report reads as an annotated brief.
- **The strike-through is the only animation**, 180ms, drawn once from the left as a pen stroke.
  Nothing else on either page animates, on purpose.
- **Exactly one accent fill per screen.** On the landing page it is the audit button and nothing else
  — verified by counting computed backgrounds, not by reading class names. The report page has none:
  a report does not shout.
- **Flat tints only.** No gradient anywhere; a gradient would be the fastest way back to the generic
  look this design exists to avoid.
- **`prefers-reduced-motion` kills every transition and animation, including `::before` / `::after`** —
  the strike rule is drawn by a pseudo-element, so a rule covering only elements would leave exactly
  the one animation in the build running. The mark itself is **not** lost: the text-decoration still
  carries it.

### 7.1 Vertical rhythm is measured, not eyeballed

The brief's rail column is **168px**, and at that width the rail's citations wrap to two lines each.
That is accepted rather than fixed, because the rail shows the citation as the drafter wrote it
(`347 U.S. 483, 495 (1954)`, up to 40 characters), the wrap happens at a space rather than mid-token,
and it is **uniform** — so every verdict mark lands on the same offset and the rhythm holds.

The two things that would break it are checked by the driver: a citation that **overflows** its
column, and a set of entries that wraps to **differing** line counts.

A **finding's** rail is a different column with a different job and fixes its own width at 264px,
because it holds the citation in full. Reusing the brief's 168px there wrapped every citation.

---

## 8. Verification protocol

A class-name grep cannot see a control rendered in its own background colour, and `tsc` cannot see a
font that silently snapped. **If we have not looked at it, we do not know it works.**

```bash
npx next build && npx next start -p 3210
node .recon/driver.mjs http://localhost:3210 .recon/shots   # 51 checks + screenshots
node .recon/contrast.mjs                                     # 48 pairs + 2 invariants
```

`driver.mjs` drives Chrome over CDP with zero dependencies (Node 24 has `fetch` and `WebSocket`) and
lands on `/`, fills the sample brief, runs the audit through the real API and screenshots the report.
It enforces four disciplines, each bought with a past mistake:

1. **Planted controls.** A probe that cannot detect a planted failure reports a confident PASS. Weights
   550/400/500/700 are planted and must read back distinctly; a same-colour control must be detected.
   If the controls fail, the entire run is discarded and says so.
2. **Hashed class names.** CSS Modules hash at build time, so `.railLabel` matches nothing and a probe
   silently measures the empty set. Selectors are `[class*="…"]` or stable `data-ui` attributes.
3. **Kill transitions before a synchronous computed-style read**, or the read returns the previous
   frame.
4. **State the colour scheme.** Headless Chrome reports `prefers-color-scheme: dark` by default, so an
   unqualified light-mode assertion fails against a good page.

Plus two that this build added, and both are recorded here because they each produced a confident
wrong answer during Phase 7:

5. **Never trust a selector that can over-match.** `[data-ui^="finding"]` also matched the inner
   `finding-meta` and `finding-source`, reporting **11 findings on a 5-finding report**. `[data-ui^="belt"]`
   matched the masthead's `belt-status` fact, reporting a belt section on a run where the belt was off.
   Both now select by element or by a trailing space that cannot over-match.
6. **A stale build is not evidence.** Two driver runs reported failures against CSS that had already
   been corrected, because the server was serving the previous build. Confirm the change is in the
   served asset before believing a failure — `curl` the CSS chunk and grep for the new value.
