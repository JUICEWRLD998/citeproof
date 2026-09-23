# Limits

What CiteProof cannot do, measured rather than assumed. Every number on this page came from a
probe in `.recon/` that you can re-run. Where a claim was later found wrong, the correction is
recorded in place rather than deleted.

Authored by **Mustapha Fadhlullah — independent security researcher**.

---

## 1. The corpus stops in 2019, and that is the most important thing on this page

Harvard's Caselaw Access Project bulk static (`static.case.law`) is the only keyless source of
verbatim opinion text. Measured coverage at each reporter's last volume
(`.recon/probe-slugs.mjs` -> `fixtures/coverage.json`):

| reporter | volumes | latest decision date |
|---|---|---|
| `us` | 572 | **2014-06-03** |
| `f-supp-3d` | 386 | **2019-08-19** |
| `f3d` | 935 | 2019-09-09 |
| `f-appx` | 714 | 2018-03-16 |
| `f-supp-2d` | 999 | 2014-08-21 |
| `f-supp` | 997 | 1998-04-24 |
| `f2d` | 999 | 1993-10-29 |
| `cal-2d` | 71 | 1969-10-21 |
| `f` | 300 | 1924-09-13 |

**`Mata v. Avianca, Inc.`, 678 F. Supp. 3d 443 (S.D.N.Y. 2023) is not in the corpus.** Neither is
any other decision after 2019 at the reporters measured. This is the case that motivates the
product — the sanctions decision about AI-fabricated citations — and we cannot read a word of it.

That is why `UNVERIFIABLE_COVERAGE` exists as a verdict distinct from `FABRICATED`. A tool that
is not boundary-aware reports the most important case in its own origin story as invented.

## 2. We cannot always tell a fabricated citation from an unreachable real one

> **Resolved in Phase 3 (2026-09-23)** — but resolved by a *heuristic with a recorded bound*, not
> by a proof, and the heuristic's own limits are §8. The original finding is kept below rather
> than deleted, because it is what the resolution was built against.

`.recon/probe-slugs.mjs` tested whether the citation's own shape separates the two, and it
**failed**:

- `999 U.S. 1234` (fabricated, E3) — `us` reaches page 2,722, so page 1,234 is not absurd.
- `678 F. Supp. 3d 443` (real, post-coverage, E4) — `f-supp-3d` reaches page 1,326.

Both are 404 on metadata, and both are structurally plausible. The probe printed
`discriminator FAILED, do not build on it` rather than a guess, and `lib/corpus/coverage.ts`
does not claim the shape distinguishes them.

**Phase 3 attacked it a second way, from the other direction.** `.recon/probe-crosscheck.mjs`
asked whether CourtListener could separate them by *content*, and it cannot — see §9. What does
separate them is a reporter's **volume growth rate**, projected to the year the citation itself
asserts: `us` ran 2.54 volumes/year, so a volume-999 cite dated 2021 is 1.697× the volume the
reporter had plausibly reached, while the real 2023 `678 F. Supp. 3d` is only 1.064×. The
`volume-implausible-for-year` reason is that claim, and §8 says exactly how much to trust it.

## 3. An exact citation match is not unique — and in `us` it usually is not

`citations[].cite` in CAP is **not a unique key**. `.recon/probe-cite-ambiguity.mjs`:

| reporter | volume | distinct cites | shared by >1 record |
|---|---|---|---|
| `us` | 572 (last) | 893 | **803 (89.9%)**, max 27 sharers |
| `us` | middle | — | 27.3% |
| `f3d` | last | — | 1.9% |
| `f2d` | last | — | 1.5% |
| `f-supp-2d` | last | — | **0.0%** |
| `f-supp-3d` | 392 | 89 | **0.0%** |
| `cal-2d` | last | — | 0.0% |

The collisions are **different cases, not duplicate records**: `572 U.S. 1082` matches 27 distinct
case ids, files and names (Christopher, Johnson, Black, Ybarra, ...). These are the Supreme Court's
**orders lists** — many short dispositions printed starting on one page, one metadata record each.

So ambiguity is an artefact of SCOTUS orders lists, not a property of the corpus generally. It is
nevertheless fatal where it occurs: a resolver that takes the first match adjudicates a quotation
against an arbitrary real case, which is the exact silent misattribution this product exists to
expose. The corpus layer therefore **refuses** — `CorpusError{kind:"Ambiguous"}`, carrying the
candidate list — rather than picking one.

Consequence worth stating plainly: **the ambiguous cases are the same ones that lack opinion
text**, because an orders-list entry has no opinion body to read. Uniqueness and emptiness are
inversely correlated, which is why the E6 fixture below could not be built from an orders-list case.

## 4. "No opinion text" is real, common, and not a verdict on its own

`.recon/probe-e6.mjs` swept 152 cases across 13 reporters, then 764 cases overall. In `us/572`,
41 of 48 sampled records have an empty `opinions` array. The condition is real.

`ResolvedCase.opinionBodyMissing` records it as a **flag, not an error** — the case resolves fine
and the UI still needs its name and citation. A quotation that is *absent* from a record with no
opinion body cannot be called fabricated, because the part we would have searched is the part that
is missing.

**Open question, deliberately not resolved in Phase 1.** `text` is assembled as
`opinions[].text` joined, then `head_matter` appended (matching the assembly the frozen
fixtures use). For an empty-opinion record, `head_matter` still contributes text, and its
length is bimodal across 56 swept records:

```
132 136 136 144 144 144 147 154 157 170 187 188 191 192 197 202 203 208 209 211 213 215 215
215 215 215 216 217 219 220 220 221 222 222 222 224 226 231 231 233 235 240 253 264 275 276
279 285 291 300 303 309 | 539 648 685 | 6397
```

Docket-only captions cluster at 132–309; there is a gap; then 539/648/685; then 6,397.
`392 F. Supp. 3d 138` (Intellectual Ventures I v. Lenovo, D. Mass., 2019-07-18) is the 6,397 case —
a unique cite, an empty majority opinion, and a large `head_matter`.

Two readings, both defensible, and they disagree on the verdict:

- **Strict** (`text` = `opinions[].text`): that case has no opinion, so an absent quotation is
  `UNVERIFIABLE_UNRESOLVED`.
- **Loose** (search all of `text`, `head_matter` included): the quotation should be searchable
  there, so absent means more than nothing.

**We have not chosen one, because choosing needs a threshold, and `implementation.md` Phase 4
warns that a threshold must be "a threshold with a recorded number, not a vibe".** Reporting E6 as
built would be that vibe. Until the definition is fixed, the E6 fixture is sourced but not wired,
and `tests/ground-truth.test.ts` keeps its `it.todo` so the gap stays visible in CI output.

What is *not* open: a positive find always wins. The matcher searches all of `text`, so a quotation
found in `head_matter` yields `VERIFIED` regardless of which definition is later adopted. The
one-directional rule that the OCR gate already follows applies here too —
**low confidence and missing text suppress accusations only, never a positive find.**

## 5. Legal-research coverage is not legal advice, and the demo says so

CiteProof answers *"does this sentence exist in this case?"* It does not answer *"is this still good
law?"* — that is Shepard's, and it is a different question. A VERIFIED verdict means a quotation is
genuinely in the cited opinion as the corpus holds it. Nothing more.

## 6. The corpus itself is a party to the dispute

Every number above is about CAP's holdings, and CAP's text is OCR'd from print, so its
`analysis.ocr_confidence` varies meaningfully: Brown v. Board **0.664**, Plessy v. Ferguson
**0.434**, Anderson v. Liberty Lobby **0.695**. The gate on that value is one-directional
(`OCR_CONFIDENCE_FLOOR = 0.5` in `lib/types.ts`), because a symmetric gate would make the flagship
VERIFIED verdict on Brown unreachable — a tool that refuses to confirm the most famous holding in
American constitutional law.

`0.5` is the midpoint of two measured anchors, **not** a statistically derived value. It is a
known-open parameter; recalibrate on a larger sample before trusting it in production.

## 7. Corrections kept in place

**Retracted (2026-09-22).** An earlier reading of the corpus held that its OCR was genuinely
damaged — a `"s finding` fragment was taken as a dropped "Hi" from "His". Checking the raw bytes
showed the corpus reads `this finding is amply supported by modern authority`, perfectly clean; the
fragment was console truncation in our own output chopping `thi` off `this`. A normalisation rule
built on that artefact would have mangled correct text. The surviving real traps are the
capitalisation one and genuine typographic quotes.

**Corrected (2026-09-22).** A first E6 sweep proposed `572 U.S. 1110` (Biton v. Lippert) as the
empty-casebody fixture. That citation matches 13 different cases (§3), so it cannot identify a case
at all, and the sweep had also verified files as `<page>-01`, which is wrong when a page holds many
records. Re-run with a uniqueness constraint, and recorded here rather than silently dropped.

---

## 8. The volume projection is a documented heuristic, and here is how much to trust it

This is the mechanism that lets the tool say `FABRICATED` for E3 while refusing for E4, so it is
the single most load-bearing judgement in the engine. It is measured, but it is **not a proof and
not a statistical model**, and the honest reading of a pass is *"could not refute"*, not *"proved
real"*.

`.recon/probe-volume-rates.mjs` measures, for each mapped reporter, the decision date of volume 1 vs
the last volume, giving a linear volume-per-year rate. Projecting from the boundary to the
citation's own asserted year gives the volume the reporter had plausibly reached by then:

| reporter | volume 1 | last volume | span | vol/yr |
|---|---|---|---|---|
| `us` | 1789-12 | 572 (2014-06-03) | 224.5 yr | **2.54** |
| `f2d` | 1924-11-17 | 999 (1993-10-29) | 68.9 yr | 14.47 |
| `f3d` | 1993-09-22 | 935 (2019-09-09) | 26.0 yr | 35.97 |
| `f-supp-3d` | 2014-04-07 | 392 (2019-08-19) | 5.4 yr | **72.86** |

The ratio is `asserted volume / projected volume`, and the bound is **1.5**:

| case | asserted | projected | ratio | call |
|---|---|---|---|---|
| E3 `999 U.S. 1234` (2021) | 999 | 588.7 | **1.697** | implausible → may accuse |
| E4 `678 F. Supp. 3d 443` (2023) | 678 | 637.4 | 1.064 | plausible → refuse |
| control `593 U.S. 1` (2021) | 593 | 588.7 | 1.007 | plausible → refuse |
| control `650 F. Supp. 3d 1` (2022) | 650 | 564.5 | 1.151 | plausible → refuse |
| control `700 F. Supp. 3d 1` (2023) | 700 | 637.4 | 1.098 | plausible → refuse |

**Why 1.5 and not the midpoint.** The measured gap is (1.151, 1.697); its geometric midpoint is
1.398. The bound is set *above* that, deliberately, because the two errors are not symmetric:
refusing to adjudicate a fabricated citation is a safe miss, while accusing a real one is the
failure this entire product exists to prevent. A real citation landing between 1.15 and 1.5 is
refused, not accused.

**What is weak about it, stated plainly:**

- One fabricated anchor against three real controls. That is not calibration.
- A **linear** rate on series that demonstrably accelerate (`us` 2.54/yr vs `f-supp-3d` 72.86/yr).
  Any reporter that slows down or speeds up after 2019 projects wrongly.
- The **asserted year is the drafter's own claim**. If a fabricated cite asserts an old year, the
  projection is skipped entirely (`ahead <= 0` → null → refuse), and the tool declines to accuse.
  That is the safe direction, but it means a fabricated cite dated before the boundary is refused
  rather than caught.
- A reporter with **no measured rate** projects to null and therefore refuses. Nothing is ever
  accused on a guessed rate — that would be a fabricated accusation wearing a number.
- **Only `us` and `f-supp-3d` are anchored by a fabricated/real pair.** The bound is applied to all
  nine reporters, which is an extrapolation.

**Falsification test, and it is wired.** `tests/resolve.test.ts` re-derives the three real controls
from `fixtures/volume-rates.json` and fails if any of them crosses the bound. So a future
recalibration that would let a real citation through breaks the build before it can break anyone.

## 9. CourtListener search is not an existence oracle, and cannot move a verdict

Phase 3 probed whether the CourtListener cross-check in §3.2 of the plan could separate E3 from E4.
It cannot, and it is worse than merely unhelpful — it is *affirmatively misleading*:

`.recon/probe-crosscheck.mjs`, searching the entirely fabricated citation `999 U.S. 1234, 1240`:

- **102 results**, top hit *United States v. Bacon*, `900 F.3d 1234` — matched on the raw page token
  `1234`, not on the citation.
- `999 X.Z. 1234` — an **unmapped reporter that cannot exist** — returned 76 results.
- Zero of the top five hits carried the queried citation in their own citation list, for the
  fabricated cite **and** for the real one.

Combined with the analyzed-matching finding elsewhere in this project (8 vs 10 quoted words return
the identical 1,068 results), the conclusion is firm: **a non-zero result count is evidence of
nothing, and a zero count is not evidence of absence either.** So the cross-check is enrichment
only — it may populate the attempt log and add a judge or docket number — and
`lib/resolve/cascade.ts` structurally cannot let it change an outcome. A throttle records as
`skipped`, never as `miss`, so *"we could not ask"* can never read as *"the second source said no"*.

