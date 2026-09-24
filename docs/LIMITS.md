# Limits

What CiteProof cannot do, measured rather than assumed. Every number on this page came from a probe in
`.recon/` — or, for the belt, from the recorded live run in `fixtures/belt-run.json` — each of which
you can re-run. Where a claim was later found wrong, the correction is recorded in place rather than
deleted.

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

## 10. The fuzzy matcher does not detect paraphrase, and the fixtures never test it

§3.5 mandates a token-alignment fallback at **≥ 0.92**, and Phase 4 ships one. What it is worth is
narrower than it sounds, and `.recon/probe-fuzzy-threshold.mjs` measures why.

**It is not a paraphrase detector, and must not be treated as one.** The nearest false candidate in
the whole fixture set is E3's fabricated quotation against the real Anderson sentence it paraphrases:
similarity **0.447**. Real quotations measure **1.000** by the exact path. So the floor sits in a
wide, empty gap, and the honest reading is that fuzzy matching is a tolerance for *OCR-scale and
typo-scale* differences, not for rewriting.

**Nothing in the ground truth exercises it.** Both true-positive fixtures are verbatim, so every one
of them is resolved by the exact path; the sweep shows 2/2 true finds and 0/5 false matches at every
floor from 0.92 down to 0.50. A feature the fixtures cannot reach would ship untested, so the fuzzy
path has synthetic positive controls in `tests/verdicts.test.ts` — and one of them immediately found
a real bug (§11).

**The floor is length-sensitive, and that is a real property rather than a defect.** One changed word
costs `1/n` of the score, so an 8-word quotation with a single change scores 0.875 and is *correctly
rejected*, while a 25-word passage with the same single change scores 0.96 and matches. Short
quotations therefore admit no paraphrase at all, which is the safe direction for a tool whose
accusations must be defensible.

**Not measured, and therefore not claimed:** no false-positive rate exists for this threshold across
a large corpus. It is calibrated against six fixtures and a handful of controls.

**The bug the synthetic controls found.** The first implementation scored a plain edit distance
against a window deliberately longer than the quotation, so every padding token counted as an
insertion: a genuine 25-token passage with one word changed scored **0.36** and the matcher returned
`null` outright, making the ≥0.92 floor unreachable and the fuzzy path dead code. It was invisible to
every fixture — which is exactly the situation described above — and one synthetic control caught it.
Fixed by making the window's unaligned ends free (fitting alignment), and a control now asserts the
returned span covers the real passage rather than the padded window.

## 11. An empty volume index is not evidence of fabrication

The precedence rule says an in-coverage citation that resolves to no case is `FABRICATED` — that is
the fabricated-citation case the product exists to catch (`999 U.S. 1234` names a volume the corpus
holds and matches nothing in it). But a volume index is the one thing this pipeline fetches
wholesale, and `lib/corpus/cache.ts` warns it is **the layer to distrust first**: a truncated or
failed fetch leaves an index that is empty or nearly so, and at the call site that is
*indistinguishable* from "no such case".

So emptiness is only evidence above a floor. `CorpusError.Unresolved` carries `indexSize`, and
`MIN_INDEX_FOR_ACCUSATION = 3` (in `lib/types.ts`) decides:

| indexSize observed | verdict | why |
|---|---|---|
| ≥ 3 | `FABRICATED` | a substantive index was searched and nothing in it claims the citation |
| < 3 | `UNVERIFIABLE_UNRESOLVED` | far more likely a truncated fetch than a real citation |

A real CAP volume index holds hundreds of records, so 3 is conservative. It is chosen on the same
asymmetry as the OCR floor — a safe miss costs a missed finding, an accusation costs credibility —
and it is **not statistically derived**. Both thresholds are known-open parameters.

**Not covered by this rule:** a citation inside coverage and under the floor is still reported as
`UNVERIFIABLE_UNRESOLVED`, not `UNVERIFIABLE_COVERAGE`. The citation is not *out* of what we hold;
we read an index for it and could not trust the answer. The distinction is kept because the two
reasons call for different fixes — one is a corpus boundary, the other is a fetch that failed.

## 12. The true home is RANKED, not found — and the rule is a proxy, not a proof

The misattribution resolver's job is to answer *"where does this sentence actually live?"* The
naive answer — "the first case containing it" — is wrong, and it is wrong in a way that produces a
confident false accusation:

`.recon/probe-misattribution.mjs` measured that **123 cases** contain *"Separate educational
facilities are inherently unequal."* Asked for that sentence, CourtListener's top hits were
`570 U.S. 297`, `51 F.3d 440`, `671 F.3d 611` — **quoting cases**. Brown was not among them. The
same probe earlier showed CL ranks the cases that quote a decision *above* the decision itself.

**The rule:** among cases containing the quotation verbatim, the **earliest published** is named the
origin. A sentence originates once and is quoted thereafter, so the earliest containing case is the
best available proxy for where it came from. Undated candidates never outrank dated ones, and ties
break on the citation string so a report is byte-stable.

**What this is not.** It is a **proxy for origin, not proof of it**. The decisive evidence would be
the citation graph — a case listing the other's citation in its own `cites_to` is demonstrably
quoting it — and the curated fixtures do not carry `cites_to`. So the resolver reports which
candidate it *believes* is the origin and shows the others beside it; it does not claim to have
established the direction of quotation. A later case that originated a line independently would be
ranked below an earlier case that merely used it.

**Corpus-dependent.** The local scan sees only what is cached. The corpus holds two real cases
containing the Brown holding (Brown itself, and McCauley v. City of Chicago, 671 F.3d 611 (7th Cir.
2011), added for exactly this purpose) — against CL's 123. Ranking is therefore *correct in kind and
incomplete in scope*: the earliest case in the corpus may not be the earliest case that exists, and
a home we name can be beaten by one we never fetched.

## 13. The CourtListener stage produces leads, and nothing becomes a home until CAP confirms it

`fixtures/corpus/` holds no full text from CL (401 on `/opinions/<id>/`, §3.4), so a CL result is a
**lead**, never a finding. The stage in `lib/match/cl-candidates.ts` enforces that: a hit becomes a
candidate only after its citation is resolved through CAP and the quotation is found **verbatim** in
the resolved opinion. Otherwise it is discarded, with the reason recorded:

| what the hit was | outcome | why |
|---|---|---|
| citation resolves, quotation found | `verified` | the only path that produces a candidate |
| citation resolves, quotation absent | `not-found-in-text` | **the decisive case** — a search result proved nothing |
| citation the corpus cannot reach | `unresolvable` | a real but post-coverage cite is still unreachable |
| hit carries no citation | `no-citation` | unaddressable: cannot be resolved to text at all |
| citation is the cited case | `excluded` | naming it would be accusing on the case already cited |

Measured, from the same probe: CL returned **zero** results for the invented E5 sentence and zero for
the E3 paraphrase. Better than the stage deserves to rely on — and it does not rely on it, which is
the point. A zero count is not treated as evidence of absence, and a non-zero count is not treated
as evidence of anything.

**Budget.** The anonymous CL tier allows roughly 5 requests/minute. The stage issues **one query per
audited item**, and reuses the hits the resolution cascade already fetched rather than searching
again — a test asserts this, because the first implementation issued two queries per item and one
test caught it. Only the first few hits are resolved against CAP (`maxLookups`, default 3), and the
stage is **off unless explicitly enabled**. A throttle records as `skipped`, never as `miss`: *"we
could not ask"* can never read as *"the second source found nothing"*.

## 14. The belt proposes; it is not an authority, and it is not measured for accuracy

The proposition belt asks a language model which sentence in an opinion supports a proposition. It is
the one component whose input is not primary law, so it is the one component the rest of the system is
built to disbelieve.

**The single rule.** The model may only **propose a span**. That span goes through `findQuoteIn` —
the same exact normalised matcher that checks the user's own quotations — and anything not found
**verbatim** is `unsupported`. `lib/verdict` does not import `lib/llm` at all, asserted by test, so no
proposal can move a verdict. A fabricated span at self-reported confidence `1.0` is rejected exactly
as one at `0.0`; a real span at `0.01` still passes. The model's confidence is carried in the log and
used for nothing else.

**What "determinism" was measured to mean, and what it does not.**

| claim | measured | status |
|---|---|---|
| `temperature: 0` + `seed` ⇒ identical output | **5/5 byte-identical** live requests, 2026-09-23 and again 2026-09-24 (`fixtures/belt-run.json`) | holds under pinning |
| …on *any* provider | **not established.** All runs were served by **Google** | the seed is a per-provider parameter, so the client pins `order: ["Google"], allow_fallbacks: false` by default rather than trusting routing |
| the request body itself is stable | asserted: fixed key order, no timestamp, byte-identical for identical inputs | what makes the seed reproducible at all |

So "the demo replays identically" is a claim about **this pinned configuration**, not about the API.
A run routed to a different provider is not comparable with these, and `fixtures/belt-run.json` names
the provider that served it for exactly that reason.

**Cost is logged, never estimated.** `usage.cost` is reported per response and **varies between
identical calls** — measured $0.000505 to $0.001884 for the same request, because prompt caching moves
the input cost. A response without a cost records `null`, not a guess: a fabricated number in a demo
budget is a lie about money. Measured cost of the whole Phase 6 record (5 identical runs plus the
decline control) was **$0.006905**, ≈$0.00115 per call on a 26.8k-character opinion — about an order
of magnitude below §3.3's estimated $0.013/citation, which was computed from the price list without
caching.

**The no-key path is the floor, and it is the deployed default.** With no `OPENROUTER_API_KEY` nothing
is proposed, **no request is issued at all**, and the belt reports `unavailable` — asserted by a
counter, not by absence of a crash. Phases 1–5 then audit exactly as they do with a key. Three
distinct facts are kept distinct, because collapsing them is how a demo ends up lying:

- `unavailable` — the belt never ran (no key, or the request failed).
- `declined` — the model returned an empty span. **Not evidence the proposition is unsupported.**
- `unsupported` — a span was proposed and the matcher could not find it.

**A rejection is described, not scored.** When a span is not found, the belt reports the **longest
run of consecutive words** it shares verbatim with the opinion. `.recon/probe-belt-diagnostics.mjs`
measured that a similarity score separates nothing — a real sentence the model *extended* scored
**0.400**, identical to a fully invented one — while the contiguous run does: real reproduction
starts at 5–12 words, incidental overlap stops at 2. `MIN_VERBATIM_RUN_TOKENS = 4` sits in that gap
and decides **only how a rejection is worded, never whether a span is accepted**.

**The key never leaves the server, checked by build rather than by assertion.** `tests/selfverify.test.ts`
greps the built client bundle in `.next/static` for the key, for the string `OPENROUTER_API_KEY`, and
for the prompt's own text; it also fails if any client component imports `lib/llm`. Two things make
that check worth having: it **resolves the key the way Next.js does** (from the environment, falling
back to the gitignored `.env`, which vitest does not load) so it cannot pass by finding no key to
search for, and it was proven able to fail — a planted `openrouter.ai/api/v1` literal in a client
component was caught, naming the exact chunk, and a client component importing `lib/llm` fails
`next build` outright.

**Not measured, and therefore not claimed:**

- **No accuracy figure exists for the belt.** How often the model proposes the *right* span, over many
  propositions, has not been measured — only that whatever it proposes is checked. A 100% rejection
  rate for a broken prompt and a 100% acceptance rate for a good one are both consistent with every
  test here.
- **The model's behaviour is not pinned.** The seed and prompt version are pinned; the weights behind
  the provider are not. `fixtures/belt-run.json` is a record of one model at one moment, with its
  generation ids, not a guarantee about the next call. A silent provider-side model update would show
  up as a changed span, and the only reason we would notice is that the record exists.
- **The decline control is one proposition, once.** That the model declined the Seventh Amendment
  proposition against Brown says nothing about its behaviour on a proposition that is *plausibly*
  relevant — which is the harder case and the one the exact matcher cannot help with, because a real
  sentence that supports nothing is real text.
- **`selfReportedConfidence` is unexplained.** It is recorded because it is free; nothing in this
  repo has established that it correlates with anything.
