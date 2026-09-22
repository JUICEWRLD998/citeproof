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

`.recon/probe-slugs.mjs` tested whether the citation's own shape separates the two, and it
**failed**:

- `999 U.S. 1234` (fabricated, E3) — `us` reaches page 2,722, so page 1,234 is not absurd.
- `678 F. Supp. 3d 443` (real, post-coverage, E4) — `f-supp-3d` reaches page 1,326.

Both are 404 on metadata, and both are structurally plausible. The probe printed
`discriminator FAILED, do not build on it` rather than a guess, and `lib/corpus/coverage.ts`
deliberately does not claim the distinction. Resolving it is Phase 3's problem (the cascade),
and until then both citations return `OutOfCoverage` from the corpus layer.

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
