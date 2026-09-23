# CiteProof — implementation.md

**LexHack 2026** · deadline **Sun 2026-09-27 17:00 EDT** = **22:00 WAT** · ~5 days from 2026-09-22
Author: Mustapha Fadhlullah — independent security researcher
**Status: GO. No hard blockers.** Eligibility confirmed by the user (student). LLM belt is OpenRouter + `google/gemini-2.5-flash`, not Anthropic.

Recon evidence for every claim in §4/§5 is in `.recon/` — 7 keyless probe scripts, all re-runnable (`node .recon/probe-*.mjs`). **Node 24 is the only toolchain required; Python is not installed on this machine**, which is why every probe is `.mjs`.

---

## 0. Gate status

| Gate | State |
|---|---|
| **R1 Student eligibility** | **CLOSED — user is a student.** |
| **R2 LLM credential** | **CLOSED 2026-09-22 — verified by one live call.** `node .recon/verify-openrouter.mjs` → `HTTP 200`, reply `"OK"`, `finish_reason: stop`, model echoed `google/gemini-2.5-flash`, generation `gen-1790112478-qepPrtxnqpcKwSoiNSI1`. The key was previously *absent*; it is now present (length 73, `sk-or-v` prefix) and proven to work. **Phase 6 is unblocked.** The belt remains optional by design — the app still degrades to the deterministic corpus path with no key. |
| **R3 Corpus coverage boundary** | Design constraint. Verify the CAP upper date boundary on Day 1 and record it in `docs/LIMITS.md`. |
| Runtime cost | Core **$0** (keyless corpora). Belt ≈ **$0.013/citation**, **~$0.26** per 20-citation brief. |
| Format | Rules want repo **or** live URL → ship both. |

**Rules that constrain the build (quote-level):** "All primary design and core software code must be created during the official hackathon timeframe"; disqualification for "Submitting pre-built projects created prior to the hackathon start date"; pre-existing "open-source libraries, public APIs, UI frameworks, and LLM APIs" are allowed **if publicly available and explicitly declared in the submission tech stack**. ⇒ Write it fresh; declare `mammoth`, `vitest`, Next.js, Harvard CAP, CourtListener, OpenRouter, `google/gemini-2.5-flash`.

### Phase 0 — complete, 2026-09-22 (receipts)

| Acceptance criterion | Result | Evidence |
|---|---|---|
| Failing tests name the verdicts | **PASS** | `npx vitest run` → 22 failed / 1 passed / 1 todo, every failure `NotImplemented`; test names cover VERIFIED (6), MISATTRIBUTED (8), FABRICATED (4), UNVERIFIABLE_COVERAGE (4), UNVERIFIABLE_LOW_CONFIDENCE (4) |
| Typecheck | **PASS** | `tsc --noEmit` exit 0 |
| Production build | **PASS** | `next build` exit 0 (Next 16.3.6) |
| Fixtures frozen before engine code | **PASS** | `fixtures/ground-truth.json` + 3 cached corpus cases; two drafted quotes were caught as not-in-corpus and one was corrected, recorded per-entry under `verified` |
| UI verified by driving a browser, not by grep | **PASS** | `.recon/driver.mjs` → **18/18**, with a planted 550/400/500 control proving the probe is not blind; screenshots in `.recon/shots/` |
| Palette ratios measured, controls planted | **PASS** | `.recon/contrast.mjs` → control correctly flags a planted 1.07:1 pair; 5 real failures found and solved |
| Coverage boundary recorded | **PASS** | `us` ends 2014-06-03 · `f3d` 2019-09-09 · `f-supp-3d` 2019-08-19 (`Mata v. Avianca` absent → E4 is real) |
| Public repo pushed | **PASS** | `origin` = `github.com/JUICEWRLD998/citeproof`. Verified with `git ls-remote`, not the push exit code: `refs/heads/main` = `0e61ccf`. `gh` is still not installed, so PRs are opened through the URL GitHub prints, not the CLI. |
| LLM key verified by one live call | **PASS** | See R2 above — HTTP 200, model echoed, generation id recorded. |

The probe scripts under `.recon/` are the evidence base and are committed — `node .recon/<name>.mjs` re-derives every number above.

---

### Phase 1 — complete, 2026-09-22 (receipts)

Built on branch `phase-1-corpus-layer`. Files: `lib/corpus/{cap,cache,coverage,slugs,index}.ts`, `tests/corpus.test.ts`, `fixtures/coverage.json`, `fixtures/corpus/index.json`, `docs/LIMITS.md`.

| Acceptance criterion | Result | Evidence |
|---|---|---|
| `getCase("347 U.S. 483")` returns >20,000 chars containing `"inherently unequal"` | **PASS** | 26,823 chars, `ocr 0.664`, `1954-05-17`. The frozen fixture offset 9564 reproduces exactly, so Phase 0's ground truth still holds |
| A second call is served from cache with **zero** network calls | **PASS** | Asserted twice: a `fetchImpl` that throws if touched on the curated path, and a call counter that does not move on the second runtime-cache read |
| `getCase("999 U.S. 99999")` returns a typed `OutOfCoverage`, not a throw | **PASS** | `CorpusError{kind:"OutOfCoverage", boundary}`. Decided **before** any I/O — the test's `fetchImpl` throws, and it is never reached |
| Reporter slug map confirmed empirically, not assumed | **PASS** | `.recon/probe-slugs.mjs` enumerated **404** reporters. The pattern is NOT uniform and every pattern-derived slug 404'd — see §4 |
| Coverage-boundary detector | **PASS** | `fixtures/coverage.json`, generated from measured data: 9 reporters with boundaries, `us` ends 2014-06-03, `f-supp-3d` 2019-08-19. Unmapped reporters return null rather than a guessed date |
| CL never on the hot path | **PASS** | No CourtListener code in Phase 1 at all. CAP static only, paced, 404s not retried |
| Typecheck / suite | **PASS** | `tsc --noEmit` exit 0; corpus suite 32/32; full suite 33 passed / 22 failed (the unchanged Phase 0 stubs) / 1 todo |

**Watch item from the plan — "if the coverage boundary is not detected here, UNVERIFIABLE becomes a lie later" — is addressed but not finished.** The boundary is detected and typed. What is deliberately *not* claimed is that a fabricated citation can be told apart from an unreachable real one; the probe failed to find that discriminator, and `coverage.ts` says so instead of guessing (§4 row 12).

---

## 1. The winning idea

**One sentence.** *CiteProof is the first citation auditor that checks every case citation and every quotation in an AI-drafted legal brief against primary law — and knows when it is the corpus, not the lawyer, that is wrong.*

**Problem.** AI-assisted drafting is standard in legal aid and small firms. The failure mode is not bad prose — it is *confident fabrication*: invented citations, and real sentences attached to the wrong case. It has produced sanctions; the people harmed are clients who cannot afford a second attempt at their own case.

**Insight.** The obvious product — "an AI that checks citations" — is where everyone lands, and it is circular: an LLM checked by an LLM fails exactly where it is needed, and fails *silently*. The real problem has three parts nobody handles:

1. **Fabrication is rare; misattribution is common.** A lawyer rarely invents a sentence. They paste a real sentence onto the wrong case. A fake-case detector misses this entirely.
2. **Naive string matching on legal text is provably unusable — reproduced against primary source during recon, by accident.** Checked case-sensitively, the most famous sentence in US constitutional law reports **0 occurrences**, because the corpus reads `Separate educational facilities are inherently unequal.` The anchor case also carries `ocr_confidence: 0.664` and visible OCR damage (`"s finding is amply supported"` — a dropped "Hi"). So any careless tool accuses a *correct* brief of fabrication. A tool that cries wolf on *Brown v. Board* is worse than no tool.
3. **A tool that cannot say "I don't know" is unusable in law.** Competitors are binary: verified / not found. In law, "not found" is an accusation.

**Solution — three-valued audit over primary law.** `VERIFIED` · `FABRICATED` / `MISATTRIBUTED` (with the true home of the sentence) · `UNVERIFIABLE` (with reason + OCR confidence). The honesty layer is the moat.

**Why different.** The LLM is a *proposer*, never an authority: it emits a candidate supporting span, and that span must then be located verbatim in the opinion by the deterministic matcher. **The hallucination detector is applied to itself** — a model that invents a supporting span gets caught by our own verifier, on camera.

**Why now.** AI-fabrication sanctions are routine and reported; free keyless primary-law corpora just made verification free at the margin; and AI drafting reached the tier that cannot afford enterprise per-seat tools.

**Idea-selection tests.** (a) If copied tomorrow, is our implementation still exceptional? Yes — corpus caches, OCR-uncertainty layer, misattribution resolver are weeks of work. (b) Could a generic prompt produce this? No — it came from empirical falsification, not ideation. (c) Will people care after? Yes; it gets more necessary as drafting spreads. (d) One unforgettable sentence? Yes, above.

**Cliche list — nothing here is submitted, nothing adjacent survives:** legal-advice chatbot · contract-review/clause extractor · document summariser · "AI paralegal" intake triage · plain case-law search UI · legal-aid eligibility checker · court-date reminder · statute explainer · legal-definition glossary · demand-letter generator.

---

## 2. The magic moment (30–60s, deterministic)

Scripted fixtures, `seed`-pinned model calls, no live dependencies.

**Before.** A brief on screen, three flagged lines. Line 1 cites a real case and quotes a *slightly* wrong sentence — not an obvious fake.

**Action.** Paste → `Audit`.

**After — three verdicts land in sequence:**

1. **`MISATTRIBUTED`.** Not "fabricated." The pane shows the sentence found verbatim in a *different* case, beside the cited case's real text, both with character offsets and deep links. The "wait, you can do that?" beat: *we didn't just fail to find it — we found where it actually lives.*
2. **`FABRICATED`.** Citation resolves to no case. Receipt: the full resolution-cascade attempt log.
3. **`UNVERIFIABLE`** with a `0.66 OCR` badge and the reason: *corpus text is OCR-degraded at this span; I will not call this a fabrication.* **This is the beat that wins** — every competitor renders this same line as a red accusation. Then show that a naive case-sensitive matcher would have mis-flagged *Brown v. Board* itself.

**Closing beat — self-verification.** Replay the belt call where **our own model proposed a span that does not exist in the opinion**, and show our verifier catching it. Judges see the mechanism, not a claim about it.

---

## 3. How it actually works

### 3.1 Pipeline

```
document (.docx / .txt / .md / pasted)
  → ingest & segment            → citation spans + quotation spans (+ offsets)
  → citation resolution cascade → resolved case + verbatim opinion text (cached)
  → quote matcher               → VERIFIED | MISATTRIBUTED | FABRICATED | UNVERIFIABLE
  → [belt] proposition          → proposed span → RE-CHECKED by the same matcher
  → audit report (JSON + UI)    → every verdict carries its own evidence
```

### 3.2 Citation resolution cascade

Naive resolution fails, and recon proves it: searching CourtListener for `"Brown v. Board of Education"` returns as its **top hit a 2015 N.D. Illinois district case**, not the 1954 SCOTUS case. Name-matching resolves to the wrong case *silently*. So resolution never trusts one source:

1. **Parse** — volume, reporter, page, pincite, year, court, case name. Short forms (`Id.`, `supra`, `347 U.S. at 495`) carry forward the last full citation.
2. **Resolve against CAP metadata** (authoritative, keyless): fetch `static.case.law/<reporter>/<vol>/CasesMetadata.json`, match on the **exact** `citations[].cite` string — *not* the name. This is the disambiguator.
3. **Cross-check via CourtListener search** on the citation string — *never* by case name. Enriches `judge`, `docketNumber`, `court`.
4. **Fetch verbatim text**: `static.case.law/<reporter>/<vol>/cases/<file_name>.json` → `casebody.opinions[].text`.
5. **Cache** by `sha256` from the CAP `analysis` block. Never fetch the same case twice.

### 3.3 LLM belt — OpenRouter + `google/gemini-2.5-flash`

**Verified against OpenRouter's public models API (2026-09-22), not from memory:**

| Property | Measured value |
|---|---|
| slug | `google/gemini-2.5-flash` |
| context_length | **1,048,576** |
| max_completion_tokens | 65,535 |
| `structured_outputs` | **true** |
| `response_format` | **true** |
| `seed` | **true** ← makes the demo replayable |
| `temperature`, `tools`, `reasoning`, `include_reasoning` | supported |
| price | $0.30/Mtok in · $2.50/Mtok out |

- Endpoint `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer $OPENROUTER_API_KEY`, OpenAI-compatible body. Optional attribution headers per OpenRouter docs (`HTTP-Referer`, `X-Title`).
- **A 1M context removes chunking and retrieval entirely.** One opinion is ~23k chars ≈ 6k tokens; brief + opinion fits whole. That is a real architectural simplification — no vector store, no chunker, no scoring.
- **Structured output** (`response_format` json_schema) for the span proposal → parse with `JSON.parse` on the returned content; never string-match the serialized payload.
- **`seed` + `temperature: 0`** ⇒ the belt is reproducible on camera. Pin both, and record the seed in the fixture file.
- **Two toggles to confirm against OpenRouter's docs at build time (marked, not asserted):** the exact shape of the `reasoning` parameter (its name is in `supported_parameters`, its schema is not), and whether `structured_outputs` is honoured identically for this model across providers (OpenRouter routes by provider — pin the provider if the demo must be stable).
- **Cost model:** 40k in + 400 out per citation = **$0.013**; a 20-citation brief = **$0.26**. The `google/gemini-2.5-flash:batch` variant is half price ($0.15/Mtok in) if latency is not needed in the demo path. `google/gemini-2.5-flash-lite` (1M ctx, structured outputs, 1/3 the price) is the fallback lever.
- **Design rule, non-negotiable:** the model may only *propose a span*. The span must then be found verbatim by the deterministic matcher. Model output passes the same verifier as the user's text.

### 3.4 Verified data contracts

**Harvard CAP bulk static — keyless and unthrottled. This is the spine.**

- `https://static.case.law/<reporter>/<vol>/CasesMetadata.json` → **array**, metadata only, **no `casebody`**.
  Fields: `id, name, name_abbreviation, decision_date, docket_number, first_page, last_page, citations[{type,cite}], court{name,name_abbreviation,id}, jurisdiction, cites_to[{cite,category,reporter,case_ids,opinion_index,case_paths}], analysis{cardinality,char_count,ocr_confidence,pagerank{raw,percentile},sha256,simhash,word_count}, last_updated, provenance, file_name`
- Full case: `https://static.case.law/<reporter>/<vol>/cases/<file_name>.json` → adds `casebody{judges, parties, opinions[{text,type,author}], attorneys, corrections, head_matter}`
- Slugs confirmed: `us`, `f2d`, `f-supp`. Graph resolves across reporters: `cites_to[].case_paths[0] = "/f-supp/98/0529-01"` → `https://static.case.law/f-supp/98/cases/0529-01.json` → **HTTP 200, 104 KB**.
- Per volume: `.zip` (2.4 MB) · `.tar` (172 MB) · `.tar.csv` (283 KB — a `path,offset,size` index into the tar; **metadata only, no case text**).
- **Anchor fixture, measured:** `us/347`, Brown v. Board, `file_name 0483-01`, `decision_date 1954-05-17`, court `U.S.`, cites `347 U.S. 483 / 98 L. Ed. 2d 873 / 74 S. Ct. 686`, 25 `cites_to` edges, majority opinion **23,216 chars**, author `Mr. Chief Justice Warren`, **`ocr_confidence: 0.664`**, `simhash 1:d88e7c45b500e8db`.

**CourtListener v4 — keyless SEARCH ONLY.**

- ✅ `GET /api/rest/v4/search/?q=<q>&type=o` → 200 anonymous: `caseName, caseNameFull, citation[], court, dateFiled, docketNumber, judge, cluster_id, opinions[{id,author_id,cites,snippet,type,download_url}]`
- ❌ `POST /api/rest/v4/citation-lookup/` → **401** · `/opinions/<id>/` → **401** · `/clusters/<id>/` → **401** · public HTML opinion pages → **HTTP 202, empty body** (bot-blocked) · v3 search → **403**
- Throttle: anonymous ≈**5 req/min** (429 `retry-after: 44`); authenticated free tier **5/min, 50/hr, 125/day**. Too low for a verification loop ⇒ never put CL on the hot path.
- **Search is *analyzed* phrase matching, not verbatim — it is not a quote oracle.** 4→6→8 quoted words narrows 38,760 → 4,843 → 1,068, but **8 vs 10 words are identical (1,068)** ⇒ stop words dropped; three impossible sentences return 0; `AND`-quoted returns 0. It also **ranks the 123 cases that quote Brown above Brown itself** ⇒ silent misattribution. Use it only as a cross-check.
- Free bulk citation map: `bulk-data/citation-map-<YYYY-MM-DD>.csv.bz2` — 36 monthly snapshots, newest **2026-06-30**, 206 MB, range requests work. Optional Day-4 enrichment.

**Dead ends confirmed:** Cornell LII 200 but *not* full text (1,298 visible chars, quote absent) · `supreme.justia.com` / `openjurist.org` / `law.justia.com` all **403** · `api.case.law/v1/` serves HTML docs, not JSON · GovInfo needs a key.

### 3.5 Normalisation — where naive tools die

Deterministic, ordered, unit-tested against the traps recon actually found:

1. Unicode NFC; curly `“ ” ’` → ASCII.
2. **Case-fold — the capital-S trap is the whole reason:** `"separate educational..."` returns 0 against `"Separate educational..."`.
3. Collapse whitespace; strip line-break hyphenation (`consti-\ntutional` → `constitutional`).
4. Repair OCR artefacts: `“s finding` → `His finding`; ligature and spacing variants.
5. **Do not** normalise away reporter spacing (`347U.S.483`) — handle it by parsing, not by mangling text.

Match order: normalised exact substring → token-alignment fuzzy (≥0.92) → not found. Every verdict carries offsets into the original opinion *and* into the user's document.

---

## 4. Verified / falsified assumptions

Kept deliberately: a plan that still asserts a falsified assumption misleads whoever reads it next.

| # | Assumption | Status | Evidence |
|---|---|---|---|
| 1 | CourtListener citation-lookup can power an app keylessly | **FALSIFIED** | 401 on POST; 401 on opinions/clusters; HTML 202-empty |
| 2 | CL search is an exact-phrase oracle usable for quote verification | **FALSIFIED** | 8 vs 10 quoted words identical (1,068) ⇒ analyzed matching |
| 3 | Free corpora give verbatim opinion text | **CONFIRMED** | CAP `us/347/cases/0483-01.json`, 23,216 chars, HTTP 200, no key |
| 4 | Citation graph resolvable free | **CONFIRMED** | `cites_to[].case_paths` → `f-supp/98/cases/0529-01.json`, HTTP 200 |
| 5 | OCR confidence available to reason about corpus quality | **CONFIRMED** | `analysis.ocr_confidence = 0.664` on Brown v. Board |
| 6 | The famous quote matches unproblematically | **FALSIFIED** | 0 occurrences case-sensitive; 1 case-folded |
| 7 | Anonymous capacity supports a verification loop | **FALSIFIED** | ~5/min anon; free authed 5/min, 50/hr, 125/day |
| 8 | Anthropic key needed for the belt | **FALSIFIED** | superseded → OpenRouter + `google/gemini-2.5-flash` (§3.3) |
| 9 | 1M context means no chunking needed | **CONFIRMED** | `context_length: 1048576` |
| 10 | CAP reporter slugs follow a uniform naming pattern | **FALSIFIED** | 404 reporters enumerated. Every pattern-derived slug 404'd (`f-2d`, `a-2d`, `so-2d`, `l-ed`, `p-2d`, `b-r`), while `us`, `f2d`, `so2d`, `l-ed-2d`, `cal-2d`, `f-appx` and `misc2d` all coexist. A synthesiser produces confident wrong URLs |
| 11 | An exact `citations[].cite` match identifies one case | **FALSIFIED** | `us/572`: 803 of 893 distinct cites are claimed by >1 record, max 27. The sharers are DIFFERENT cases — SCOTUS orders lists print many dispositions per page. But this is an `us` artefact, not corpus-wide: `f-supp-2d` and `f-supp-3d` measured **0.0%**, `f2d` 1.5% |
| 12 | A citation's shape separates a fabricated cite from an unreachable real one | **FALSIFIED** | `.recon/probe-slugs.mjs` printed `discriminator FAILED`. `999 U.S. 1234` is structurally plausible (`us` reaches page 2722) and so is `678 F. Supp. 3d 443` (`f-supp-3d` reaches 1326). Both 404. **Partly superseded by row 18** — a *volume-growth projection* separates them, but the shape check does not, and `coverage.ts` still claims nothing from shape |
| 13 | Empty-opinion corpus records are rare edge cases | **FALSIFIED** | 41 of 48 sampled `us/572` records have an empty `opinions` array (orders lists). Captured as a flag, not an error, so Phase 4 cannot reach FABRICATED from it |
| 14 | All four Phase 2 normalisation traps are real | **FALSIFIED** | Only **three** are. `“s finding` is the retracted finding — **0 occurrences of `“s`** in the raw bytes; the corpus reads "this finding is amply supported by modern authority", clean. Hyphenation is also absent (0 occurrences of `-\n`). See the Phase 2 correction |
| 15 | A ground-truth quote can be located with `brief.indexOf(quote)` | **FALSIFIED** | Returns **-1 for all five** expectations: the fixture stores quotations whitespace-normalised while the brief wraps them across lines. Every Phase 0 test item was silently built with a zero-length span at offset 0, invisible only because `auditItem` was still `NotImplemented` |
| 16 | CourtListener search can separate a fabricated cite from an unreachable real one | **FALSIFIED** | `.recon/probe-crosscheck.mjs`: the fabricated `999 U.S. 1234, 1240` returned **102** results, top hit *United States v. Bacon*, `900 F.3d 1234` — matched on the raw page token `1234`. `999 X.Z. 1234`, an unmapped reporter that cannot exist, returned **76**. Zero of the top five hits carried the queried citation in their own list, for E3 **and** E4. A non-zero count is evidence of nothing. The cross-check is now enrichment only and structurally cannot move a verdict |
| 17 | A reporter's volume growth rate separates a fabricated cite from an unreachable real one | **CONFIRMED** | `.recon/probe-volume-rates.mjs`: `us` ran **2.54 vol/yr**, so volume 999 at asserted year 2021 is **1.697×** the projected ~589; E4 at 2023 is **1.064×**. Three real controls measure **1.007 / 1.151 / 1.098**, so bound **1.5** separates them. **Heuristic, not a proof** — one fabricated anchor against three controls, a linear rate on series that demonstrably accelerate (`f-supp-3d` 72.86/yr). Limits recorded as `docs/LIMITS.md` §8, with a wired falsification test |
| 18 | A refusal and an accusation can share one "nothing found" return value | **FALSIFIED** | Four distinct situations collapsed into a nullable return — resolved / refused / implausible / ambiguous — and collapsing them is how a tool accuses real cases. `CascadeOutcome` is now a closed union, and `CorpusError.why` is machine-readable so the verdict layer branches on the type rather than parsing prose |

**Retraction note (kept by convention).** Mid-recon I concluded from a snippet dump that CL search "returns 135 cases that don't contain the phrase." That inference was unsound — it read *phrase absent* off a snippet that merely doesn't display it, and opinions are long. §3.3's rigorous tests replaced it. The corrected finding is subtler and is what the product is built on.

**Correction note (Phase 1, kept by the same convention).** The first E6 sweep proposed `572 U.S. 1110` (Biton v. Lippert) as the empty-casebody fixture. It is unusable: the citation matches **13 different cases**, and the sweep had verified case files as `<page>-01`, which is wrong when one page holds many records — so it had confirmed the wrong records. Re-run under a uniqueness constraint. The replacement (`392 F. Supp. 3d 138`) is sourced but still **not wired**, because what "no casebody text" means is unresolved: its `head_matter` is 6,397 chars and the measured distribution is bimodal with no obvious cut. Phase 4 requires a threshold with a recorded number, so the fixture stays unwired and the `it.todo` stays visible rather than a vibe being encoded. Both corrections, and the two retracted claims, are carried in `docs/LIMITS.md` §7.

---

## 5. Design system — "Annotated Brief"

**Direction derived from the subject, not from a tech aesthetic.** The subject is a legal brief under audit: paper, ink, a margin, and marks in that margin. So the vocabulary is the *annotated brief*.

**Explicitly rejected (the traps for this brief):** terminal / CRT / neon (the default trap for any hacking-or-forensics brief) · near-black + one acid accent · violet/indigo glass · gradient cards · centred hero + three feature cards + gradient CTA.

**Base language:** `warm-calm-ui` (paper-and-ink, one accent, weight 550, warm-tinted shadows, flat tints, quarter-step spacing). Adopted as *grammar*; the vocabulary below is derived from the subject. Two deliberate departures: **CSS Modules + tokens, not Tailwind** (standing rule), and a **bounded semantic verdict layer** — that skill warns off many-semantic-colour dashboards, so this extends it rather than applying it blindly.

### 5.1 Tokens

```
SURFACE   paper #f8f7f4   surface #fffefa   line #e2e1da
INK       ink #292a26   muted #777970   faint #a8a99f
ACCENT    terracotta #f45e38   hover #f37954 (LIGHTER — never darken)
          on-accent #3e2118 (dark warm brown — NEVER white)
VERDICT   verified        #2f6b4f   deep green, paper-legible
          misattributed   #b26b00   amber
          fabricated      #b02a1f   warm red
          unverifiable    NO COLOUR — muted #777970 + 1px dashed rule
TYPE      DM Sans Variable (weight 550 everywhere; 650 hero) + DM Mono, citations only
RADIUS    5 chip · 7 control · 10 card · 13 dialog
MOTION    0.15s colour · 0.2s transform · hover lift 2px · reduced-motion kills all
SHADOW    warm-tinted only
```

**DM Sans *Variable* is mandatory** — `font-weight: 550` snaps to 500/600 on a static face and every heading looks subtly wrong with no error anywhere. Pin the variable file and assert the computed weight is `550`.

**Mono is earned, not decorative:** reporter citations (`347 U.S. 483`, `678 F. Supp. 3d 443`) are a formal notation. Mono is confined to citation spans and micro-labels. Micro text gets **positive** tracking (+0.5–0.6px); negative tracking belongs to large type only.

### 5.2 The design encodes the product's ethics

`UNVERIFIABLE` is the **quietest thing on screen** — no colour, muted ink, a dashed hairline. The other three are saturated. The interface therefore *looks* like a tool that refuses to overclaim. That is the single most persuasive visual decision available here, and it is free.

### 5.3 The one boldness, spent once per screen

The **margin rail.** Every audited citation gets a left margin column: the reporter citation set in mono, a hairline rule, and its verdict mark. The report reads like an annotated brief — the *document* is the hero, not the tool. The fabricated line is struck through by a warm-red rule drawn over 180ms; **that is the only animation on the page.** Verdict glyphs are drawn inline SVG margin marks, never emoji, never generic checkmarks.

### 5.4 Slop self-audit — run *before* styling, not after

| Tell | Status |
|---|---|
| 1 Near-black + one acid accent | avoided — warm paper + terracotta, no acid |
| 2 Violet/indigo glass | absent |
| 3 Centred hero + 3 feature cards + gradient CTA | absent — the report is a two-column document layout |
| 4 Generic sans everywhere, mono as decoration | mono confined to citations only |
| 5 Emoji as icons | drawn SVG margin marks |
| 6 Gradient mesh / glow | flat tints only; grep for `gradient(` and justify every hit |
| 7 "AI-powered" badge copy | copy states a fact and a boundary |
| 8 Neon borders + glow | hairline warm rules, no glow |
| 9 Dark mode by naive inversion | dark mode is a **separate warm-dark spec**; the accent is retired for near-white there per the skill, not inverted |
| 10 Motion as decoration | one strike-through, once |

### 5.5 Verification protocol (mandatory — a grep cannot see an invisible button)

- **Drive a browser; never infer rendered state.** `chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<tmp>`; Node 24 has `fetch` + `WebSocket`, so a CDP driver needs **zero dependencies**. `Runtime.evaluate` to click by text, `Page.captureScreenshot` to look.
- **Do NOT use `--virtual-time-budget` against `next dev`** — the HMR websocket never settles and the command hangs.
- **Measure contrast numerically, don't eyeball it.** Write the WCAG ratio for every foreground/background pair into `docs/DESIGN.md`. "Bright enough" and "16:1" feel identical, while "1.00:1" silently deletes a verdict badge on a projector.
- **Every DOM probe gets a planted positive control** that must fail on purpose first — otherwise a working detector and a decorative `if` look identical.
- **Kill transitions before a synchronous `getComputedStyle` read** (`transition: none !important`, read, restore), or you photograph the previous frame.
- In Git Bash, avoid `/regex/` shapes in `until` conditions — MSYS rewrites the leading slash; use `indexOf('x') > -1`.

---

## 6. Implementation phases

Each phase ends with **acceptance criteria that are testable**, and a named failure mode to watch. Phases 1–5 are pure logic and are *fully testable without the network* via cached fixtures — build them that way.

### Phase 0 — Foundation · Day 0, ~2h
**Goal:** a public repo with failing tests that encode the ground truth, before any engine code exists.
**Tasks:** confirm `OPENROUTER_API_KEY` with one live call · `git init` + identity + public remote + push (visible velocity, and rules require in-window authorship) · Next.js App Router + TypeScript scaffold · `vitest` configured · **freeze `fixtures/` and `fixtures/ground-truth.json` first** · verify the CAP coverage boundary date · `docs/LIMITS.md` skeleton.
**Files:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `fixtures/*`, `fixtures/ground-truth.json`, `docs/LIMITS.md`, `.env.example`
**Acceptance:** `npx vitest run` exits non-zero with named failures (asserting `VERIFIED`/`MISATTRIBUTED`/`FABRICATED`/`UNVERIFIABLE` per fixture line); repo pushed and verified with `git ls-remote` (never trust the push exit code alone).
**Watch:** writing engine code before the fixtures. The ground truth must be authored independently, or the tests merely restate the implementation.

### Phase 1 — Corpus layer · Day 1
**Goal:** fetch, cache, and serve primary-law opinion text keylessly.
**Tasks:** reporter-slug map (`us`, `f2d`, `f-supp` + ~10 more) · volume metadata fetch · case fetch → `casebody.opinions[].text` · `sha256` disk cache under `.cache/` · retry/backoff for the ~5/min CL budget (CL must never be on the hot path) · CAP coverage-boundary detector.
**Files:** `lib/corpus/cap.ts`, `lib/corpus/cache.ts`, `lib/corpus/slugs.ts`, `lib/corpus/coverage.ts`, `tests/corpus.test.ts`
**Acceptance:** `getCase("347 U.S. 483")` returns text of length **> 20,000** containing `"inherently unequal"`; second call is served from cache with **zero** network calls (assert with a fetch spy); `getCase("999 U.S. 99999")` returns a typed `OutOfCoverage` error, not a throw.
**Watch:** the coverage boundary is the honesty layer's foundation. If it is not detected here, `UNVERIFIABLE` becomes a lie later.

### Phase 2 — Citation parser & normalisation · Day 2
**Goal:** extract citations and normalise text correctly on all four known traps.
**Tasks:** citation regex/parser (volume, reporter, page, pincite, court, year) · short-form carry-forward (`Id.`, `supra`, `at 495`) · the §3.5 normalisation chain · offset tracking.
**Files:** `lib/resolve/parse.ts`, `lib/match/normalize.ts`, `tests/parse.test.ts`, `tests/normalize.test.ts`
**Acceptance:** parses `347 U.S. 483`, `678 F. Supp. 3d 443`, `84 F. Supp. 3d 784`, `347 U.S. at 495`; **four trap tests green:** `"separate educational..."` matches `"Separate educational..."`; curly→ASCII; `consti-\ntutional` → `constitutional`; `“s finding` → `His finding`; **offsets map back to the original, un-normalised string**.
**Watch:** offsets into the *normalised* string are worse than no offsets — they deep-link to the wrong characters. Test the round-trip explicitly.

**CORRECTION to this phase's acceptance criteria (added Phase 2, 2026-09-22).** The Acceptance line above names **four** traps. Only **three** are real. The fourth — `“s finding` → `His finding` — is the *retracted* OCR-damage finding. `.recon/probe-normalisation-traps.mjs` measures **0 occurrences of `“s`** across all fixtures; the corpus reads `this finding is amply supported by modern authority`, clean. The `“s` was our own console truncation.

The rule is implemented **nowhere**, deliberately. Implementing it would not fail loudly — it would rewrite correct text into other correct-looking text, and the damage would surface only as a lost match. `tests/normalize.test.ts` asserts the zero count and pins the decision, so nobody re-derives the rule from this line without meeting the evidence. It is left in the criteria above rather than deleted, so the correction is visible where the claim was made.

Two further measured notes on the same line: **hyphenation is also ABSENT** from this corpus (0 occurrences of `-\n`), so that rule is kept but never fires on real data; and **NFC normalisation is length-preserving** on every fixture and the brief, which is what licenses applying it ahead of the offset map — with a guard test that fails if that stops being true.

### Phase 2 — complete, 2026-09-22 (receipts)

Built on branch `phase-2-parser-normalisation`. Files: `lib/match/normalize.ts`, `lib/match/match.ts`, `lib/resolve/parse.ts`, `tests/normalize.test.ts`, `tests/parse.test.ts`.

| Acceptance criterion | Result | Evidence |
|---|---|---|
| Parses `347 U.S. 483` | **PASS** | vol/reporter/page + `year 1954` |
| Parses `678 F. Supp. 3d 443` | **PASS** | Longest-spelling alternation; `F. Supp. 3d` wins over `F. Supp.` |
| Parses `84 F. Supp. 3d 784` | **PASS** | The truncation trap: a shorter reporter match would have read page **3** |
| Parses `347 U.S. at 495` | **PASS** | Recorded as pincite 495, page 0, `shortForm: true` |
| Trap: `"separate educational..."` matches `"Separate educational..."` | **PASS** | Case-fold; `Separate` at corpus offset **9564**, lowercase `-1` |
| Trap: curly → ASCII | **PASS** | 177 U+201C, 168 U+201D, 103 U+2019 present in fixtures |
| Trap: `consti-\ntutional` → `constitutional` | **PASS** | Implemented; measured **0** occurrences in this corpus so it never fires here |
| Trap: `“s finding` → `His finding` | **NOT APPLICABLE** | **Retracted finding — 0 occurrences.** Asserted absent instead, see the correction above |
| Offsets map back to the ORIGINAL, un-normalised string | **PASS** | Round-trip asserted for every fixture, plus explicit cases for a match preceded by, and ending on, collapsed whitespace |
| Short-form carry-forward (`Id.`, `supra`, `at 495`) | **PASS** | `Id. at 495` resolves to Brown's coordinates while reporting the text a lawyer wrote |
| Typecheck / suite | **PASS** | `tsc --noEmit` exit 0; parse 33/33; normalize + traps 33/33; full suite **104 passed / 13 failed / 1 todo**, and all 13 failures are the single `auditItem is not implemented yet — Phase 4` |

**Watch item addressed:** the round-trip is tested explicitly rather than assumed, and the mapped-offset design exists *because* of it — offsets measured in normalised space would point at the wrong characters in the original.

---
### Phase 3 — Resolution cascade · Day 2–3

**Goal:** citation string → resolved case + verbatim text, never by case name.
**Tasks:** CAP exact-`citations[].cite` match · CL search cross-check on the citation string only · merge enrichment · a **visible attempt log** (demo material, not debug output).
**Files:** `lib/resolve/cascade.ts`, `lib/resolve/courtlistener.ts`, `tests/resolve.test.ts`
**Acceptance:** `"347 U.S. 483"` resolves to the 1954 SCOTUS case; **a case-name-only query is rejected by design** (regression test asserting we never resolve by name); an unresolvable citation returns `FABRICATED` with a populated attempt log; the log serialises to JSON.
**Watch:** CL's top hit for the *name* is a 2015 district case. If any code path matches on name, the tool silently mis-attributes — the exact bug we sell against.

### Phase 3 — complete, 2026-09-23 (receipts)

Built on branch `phase-3-resolution-cascade`. Files: `lib/resolve/cascade.ts`, `lib/resolve/courtlistener.ts`, `tests/resolve.test.ts`; modified `lib/corpus/coverage.ts`, `lib/corpus/index.ts`, `lib/types.ts`. New evidence base: `.recon/probe-crosscheck.mjs`, `.recon/probe-volume-rates.mjs` → `fixtures/volume-rates.json`.

| Acceptance criterion | Result | Evidence |
|---|---|---|
| `"347 U.S. 483"` resolves to the 1954 SCOTUS case | **PASS** | `Brown v. Board of Education`, `1954-05-17`, 26,823 chars, frozen offset **9564** reproduced. Resolved from the curated index with `networkCalls() === 0` |
| A case-name-only query is rejected by design | **PASS** | Asserted four ways: a name-only citation refuses with `why: "no-citation"`; `looksLikeCitation("Brown v. Board of Education")` is false; `searchByCitation` returns `[]` **having issued zero requests** (the refusal precedes the fetch); and `CourtListenerClient.prototype.searchByName` is asserted `undefined` — there is no name path to call |
| An unresolvable citation returns FABRICATED with a populated attempt log | **DEFERRED to Phase 4 by design** | The cascade supplies the *input* to that verdict: E3 returns `state: "implausible"` with a recorded ratio/bound, which is what licenses the accusation. The verdict itself is `auditItem`, still the Phase 4 stub |
| The log serialises to JSON | **PASS** | Asserted for every ground-truth line and for the whole brief, via `JSON.parse(JSON.stringify(trace))` deep-equality |
| Watch item: no code path matches on case name | **PASS** | Same evidence as row 2. The cascade has no name parameter anywhere |
| Typecheck / suite | **PASS** | `tsc --noEmit` exit 0; resolve 28/28; full suite **132 passed / 13 failed / 1 todo**, all 13 failures still the single `auditItem is not implemented yet — Phase 4` stub |

**The phase's real problem, and how it was solved.** The corpus layer returns the **same** typed failure for E3 (`999 U.S. 1234`, fabricated → must be `FABRICATED`) and E4 (`678 F. Supp. 3d 443`, real but post-coverage → must be `UNVERIFIABLE_COVERAGE`). §4 row 12 already recorded that no page/volume *shape* check separates them. Two probes were run against the question, and only the second one works:

- `.recon/probe-crosscheck.mjs` — **CourtListener cannot separate them, and is affirmatively misleading.** Searching the fabricated `999 U.S. 1234, 1240` returned **102** results whose top hit was *United States v. Bacon*, `900 F.3d 1234` — matched on the raw page token `1234`. `999 X.Z. 1234`, an unmapped reporter that cannot exist, returned **76**. Zero of the top five hits carried the queried citation in their own list, for E3 **and** for E4. So the cross-check is enrichment only, and the cascade is structured so it cannot move an outcome. Recorded as §9 of `docs/LIMITS.md`.
- `.recon/probe-volume-rates.mjs` — **volume growth projection does separate them.** `us` ran **2.54 vol/yr**, so by E3's asserted year 2021 it had plausibly reached ~589 volumes, making volume 999 **1.697×** the projection; E4 at 2023 is **1.064×**. Three real-citation controls measured **1.007 / 1.151 / 1.098**, so a bound of **1.5** separates them — placed deliberately *above* the geometric midpoint (1.398), because refusing a fabricated citation is a safe miss while accusing a real one is the worst outcome available.

**Design consequence.** An outcome is a closed union — `resolved` / `refused` / `implausible` / `ambiguous` — not a nullable case, because four very different situations all look like "nothing found" and collapsing them is exactly how a tool ends up accusing real cases. Only `implausible` may reach `FABRICATED`, and it needs **no network at all**: it derives from two local measured fixtures. A test asserts E3 still comes back `implausible` under a total simulated outage, while every real citation in the brief is refused — the accusation rests on measured data, not on a request that could fail.

**A wrong invariant I wrote and then corrected.** My first version of that test asserted *nothing* may be `implausible` during a network outage. It failed, and the test was wrong, not the code: `implausible` is network-independent by design, so asserting it away would have pinned a worse property. Rewritten to assert what actually matters — unreachable **real** cases are refused.

**Watch item addressed:** the cross-check is OFF by default and asserted to issue **zero** requests unless explicitly enabled, because the anonymous budget is ~5/min and the probe proved it adds no evidential weight. A throttle records as `skipped`, never `miss`, so "we could not ask" cannot read as "the second source disagreed".

---

### Phase 4 — Quote matcher & verdicts · Day 3
**Goal:** four-valued verdicts with evidence.
**Tasks:** normalised exact substring → fuzzy token alignment (≥0.92) · verdict logic · OCR-confidence gating so a degraded span yields `UNVERIFIABLE` rather than an accusation.
**Files:** `lib/match/match.ts`, `lib/verdict/verdicts.ts`, `lib/verdict/ocr.ts`, `tests/verdicts.test.ts`
**Acceptance:** all four verdict branches reachable from fixtures; a correct quote from a 0.66-OCR case is **never** `FABRICATED`; every verdict returns offsets + a reason string; unit-tested against the `"separate educational..."` case-sensitivity trap.
**Watch:** the OCR gate must be a *threshold with a recorded number*, not a vibe. If it silently flips verdicts the honesty layer is theatre.

### Phase 5 — Misattribution resolver · Day 3–4
**Goal:** given a sentence absent from the cited case, find where it actually lives.
**Tasks:** local-cache scan first, then a single budgeted CL search · rank candidates · render a side-by-side diff.
**Files:** `lib/match/misattribution.ts`, `tests/misattribution.test.ts`
**Acceptance:** the fixture sentence planted in the wrong case is recovered to its true home with a deep link; a genuinely invented sentence returns no candidate and stays `FABRICATED`.
**Watch:** this is the differentiator — protect this phase's time. A false "found it elsewhere" is worse than no feature; require an exact normalised match before claiming a new home.

### Phase 6 — Proposition belt + self-verification · Day 4
**Goal:** LLM proposes a supporting span; our matcher adjudicates it.
**Tasks:** OpenRouter client (`lib/llm/openrouter.ts`) with `response_format: json_schema`, `temperature: 0`, **pinned `seed`** · prompt returns a span only · **span is verified by the Phase-4 matcher** · record seed + prompt version in the fixture · cost logging from the response usage block.
**Files:** `lib/llm/openrouter.ts`, `lib/llm/proposition.ts`, `lib/llm/selfverify.ts`, `tests/selfverify.test.ts`
**Acceptance:** a stubbed model response citing a span that is **not** in the opinion is caught and reported as an unsupported span; a real span passes; identical seed ⇒ identical output across runs; the key is read server-side only and never reaches the client bundle (assert by grepping the built client output for the key).
**Watch:** the belt must have a **no-key path** — if `OPENROUTER_API_KEY` is absent the app degrades to Phases 1–5 and still audits. Never let the demo depend on the belt being up.

### Phase 7 — UI · Day 4
**Goal:** the §5 design system, browser-verified.
**Tasks:** tokens + DM Sans Variable + DM Mono · the margin-rail report view · verdict glyphs as inline SVG · empty/loading/error states written as a person would · the strike-through animation · `docs/DESIGN.md` with measured contrast ratios.
**Files:** `app/page.tsx`, `app/report/[id]/page.tsx`, `app/globals.css`, `styles/tokens.css`, `components/*.module.css`, `docs/DESIGN.md`, `.recon/driver.mjs`
**Acceptance:** screenshots of (a) a full report, (b) the `UNVERIFIABLE` row, (c) tab focus order · computed `font-weight` on headings is **exactly 550** · every fg/bg pair's WCAG ratio written down · one accent moment per screen · `prefers-reduced-motion` disables all motion · the margin rail aligns with the document at 375px width with no horizontal scroll.
**Watch:** verify by screenshot, never by grepping built HTML for class names — that cannot detect a control rendered in its own background colour.

### Phase 8 — Harden, deploy, submit · Day 5
**Goal:** a demo that survives a projector and a judge.
**Tasks:** deploy to a live URL + smoke-test every route with `curl` · record the ≤3-min video against **seeded fixtures** · README as an AI-judge artifact (§9) · declare the tech stack · Devpost submit.
**Acceptance:** live URL audits the fixture brief end-to-end; video plays the full Magic Moment in one unbroken take; README contains the rubric mapping and the §4 falsified table; `npx vitest run` green in the video.
**Watch:** rehearse before recording. Keep the model belt optional in the take so a rate limit cannot kill the recording — and record the degraded path too, because *"it still audits with no key"* is itself a selling point.

---

## 7. Repo layout

```
app/                    Next.js App Router + CSS Modules (tokens; NO Tailwind)
  page.tsx              audit input
  report/[id]/page.tsx  margin-rail verdict view
  api/audit/route.ts    engine entry (key stays server-side)
lib/corpus/             cap.ts cache.ts slugs.ts coverage.ts
lib/resolve/            parse.ts cascade.ts courtlistener.ts
lib/match/              normalize.ts match.ts misattribution.ts
lib/verdict/            verdicts.ts ocr.ts
lib/llm/                openrouter.ts proposition.ts selfverify.ts
fixtures/               briefs + ground-truth.json  (tests read only these)
tests/                  vitest — normalisation traps + all verdict branches
.recon/                 probe-*.mjs (evidence base, cited in README) + driver.mjs
docs/                   LIMITS.md  DESIGN.md
.cache/                 sha256-keyed opinions (gitignored)
```

---

## 8. Schedule

| Day | Phases | Exit condition |
|---|---|---|
| **0 (today)** | 0 | ✅ Public repo pushed; failing tests name the four verdicts; key verified |
| 1 | 1 | ✅ Brown fetched + cached; coverage boundary recorded |
| 2 | 2, 3 | ✅ Three trap tests green (the fourth was retracted, §4 row 14); cascade never resolves by name |
| 3 | 4, 5 | All four verdicts reachable; misattribution recovers the true home |
| 4 | 6, 7 | Belt self-verifies; UI screenshotted and contrast-measured |
| 5 | 8 | Live URL + video + README + submitted |

**Progress note (2026-09-23).** Phases 0–3 are complete and merged; `main` carries all three. Phase 2 took one additional branch-free correction (the retracted fourth trap) and Phase 3 took two probes to settle its central question, both recorded above. Remaining: Phases 4–8, and the two open items the plan deliberately leaves open — E6's verdict definition (`docs/LIMITS.md` §4) and the OCR floor's calibration (§6).

**Fan-out:** orchestrator does Phase 0 and the shared interfaces first, then one subagent per disjoint file set (Phases 1–2 in parallel; 3–4 in parallel; 5–6 sequential because 6 depends on 4). Orchestrator re-verifies everything, then commits.

**Cut order if behind:** citation-graph structural checks → `.docx` export → extra reporter slugs → the belt (Phases 1–5 alone still win on the misattribution + honesty story).

---

## 9. Submission checklist

- [ ] Public repo + live URL (rules accept either; ship both)
- [ ] Video **≤3 min**, YouTube/Vimeo/Loom, showing working software
- [ ] Problem/solution write-up on the civic/legal/AI issue
- [ ] Tech stack + credits: `mammoth`, `vitest`, Next.js, Harvard CAP static, CourtListener API, OpenRouter, `google/gemini-2.5-flash` — **the rules require transparent disclosure of libraries and AI tools**
- [ ] README as an AI-judge artifact: problem → insight → architecture → honesty rails → the §4 verified/falsified table → real receipts (URLs, offsets, the 0.664 confidence) → a "how this is scored" section against the rubric
- [ ] Test evidence: trap tests + all four verdict branches, green, on video
- [ ] Devpost submitted with margin

**Rubric → evidence**

| Criterion | Weight | Evidence |
|---|---|---|
| Real-World Impact & Feasibility | 25% | Named sanction harm; free for legal aid; $0 core runtime; live URL |
| Technical Execution & Functionality | 25% | Keyless primary-source pipeline; resolution cascade; trap tests; four verdicts with offsets |
| User Experience & Design | 20% | Annotated-Brief system; measured contrast; margin rail; the quiet `UNVERIFIABLE` |
| Innovation & Originality | 15% | Misattribution resolution; OCR-uncertainty verdict; self-verified belt |
| Presentation & Documentation | 15% | ≤3-min deterministic demo; README mapped to this table; `docs/LIMITS.md` |

---

## 10. Startup potential

**Users & wedge.** The AI-drafting quality-control line item in small firms and legal-aid organisations — the tier priced out of Clearbrief/Paxton/CoCounsel. The durable second buyer: **malpractice insurers**, who underwrite exactly this risk and have no instrument for it.

**Model.** Per-audit credits + per-seat; free for legal-aid and public-defender offices (which is also the access-to-justice story the largest rubric criterion rewards).

**Distribution.** Bar associations, legal-aid consortia, clinics. Land-and-expand is natural: one flagged brief sells a seat.

**Moat.** Not the matching (copyable) but the verified-span corpus and its hashes; the OCR-uncertainty and coverage-boundary *calibration* layer, which only accumulates by doing the work; and the audit trail an insurer and a disciplinary body both want.

**Expansion.** State/administrative sources → secondary sources → the same engine on medical and patent citations, where "real source, wrong attribution" is equally sanctionable.

---

## 11. Competitive landscape — honest overlap

| Product | What it does | Where it falls short here |
|---|---|---|
| **Clearbrief** | Citation + quote checking, Word-integrated | Closest real competitor. Enterprise per-seat, closed, binary verdicts, no OCR-uncertainty or coverage honesty |
| **Paxton AI** | Drafting + citation check | Bundled into a drafting product; not an auditable, keyless verifier; no misattribution framing |
| **CoCounsel / Thomson Reuters** | Retrieval + citation lookup over Westlaw | Trust-owned, expensive, no open evidence trail; absent where the harm is worst (legal aid) |
| **Shepard's / CiteCheck** | Citation validity | Answers *"is it still good law"*, not *"does this sentence exist in it."* Adjacent, different question |
| **LLM-checking-LLM tools** | Ask a model "is this real?" | Circular; fails silently exactly where needed, and confidently confirms plausible fabrications |

**The gap.** Nobody ships a *three-valued* verifier over free primary law that (a) separates fabrication from misattribution, (b) refuses to accuse when the corpus is the unreliable party, and (c) emits offsets and an evidence trail a third party can re-run. It is defensible because it is a discipline, not a feature.

---

## 12. Judge attack — the 10 hardest questions

1. **"Isn't this a wrapper around CourtListener?"** No — CL is 401 on every endpoint carrying opinion text. The corpus is Harvard CAP primary source, keyless; CL is only a cross-check. §3.4.
2. **"Isn't an LLM checking an LLM circular?"** That is the thesis. The verifier is deterministic string/graph logic over primary text; the LLM may only propose a span, which is then checked. We demo our own model being rejected.
3. **"What if the corpus is wrong?"** A first-class outcome, not a bug: `UNVERIFIABLE` with `ocr_confidence` shown. Brown v. Board scores 0.664.
4. **"Your coverage stops somewhere. What about a 2024 case?"** We detect the boundary and return `UNVERIFIABLE-COVERAGE`, never "fabricated." A verifier that accuses outside its competence is unsafe to ship. The one thing that *can* be accused past the boundary is a citation whose volume could not have existed at the date it asserts — a measured volume-growth projection with a recorded bound, and the limits of that heuristic are documented rather than hidden (`docs/LIMITS.md` §8).
5. **"How is this different from Clearbrief?"** It is enterprise, closed, and binary. We are keyless, open, three-valued, distinguish misattribution, and serve the legal-aid tier it does not.
6. **"Are you giving legal advice?"** No — we report textual and citation facts with offsets. No advice, no view on the merits.
7. **"Privileged documents on your server?"** A real limitation, stated plainly. Core is local-first; a `--local` mode has no egress except public case-law fetches, and the demo shows the audit log of exactly which bytes left the machine.
8. **"What does one audit cost?"** Core $0 (no key, no quota). Belt $0.013/citation, ~$0.26 for a 20-citation brief — measured from the model list, not estimated.
9. **"What's the business?"** Per-audit and per-seat, free for legal aid; the durable buyer is malpractice insurers.
10. **"Why now?"** Sanctions became routine; free keyless primary-law corpora made verification free at the margin; AI drafting reached the tier that cannot afford enterprise tools.

---

## 13. Winning pitch (60 seconds, founder voice)

> Last year a lawyer filed a brief citing cases that did not exist. The court sanctioned him. His client — who could not afford a second attempt at their own case — lost anyway.
>
> The obvious fix is an AI that checks citations. I built the opposite, because that doesn't work: one model verifying another fails silently, exactly when it matters.
>
> So CiteProof doesn't ask a model. It fetches the actual opinion from primary law — no key, no rate limit — and checks every citation and every quotation against the text itself. And when it can't be sure, it says so.
>
> Watch this. Three flagged lines. One is a real sentence attached to the wrong case — and I don't just fail to find it, I show you where it actually lives. One is invented, and I show you the resolution log. And one I refuse to call. Here's why: the corpus text is OCR-damaged at that spot — and the most famous sentence in constitutional law would be flagged as fake by any tool that doesn't account for that.
>
> A tool that cries wolf on *Brown v. Board* is worse than no tool at all. CiteProof is built to be trusted when it accuses — and honest when it can't be.

---

## 14. Final verdict

**Win probability: 7/10** for top-3 given the build completes; **9/10** for being remembered and fellowship consideration.

**Why it wins.** The one idea in the field that a generic prompt cannot produce; differentiators came from empirical falsification rather than brainstorming; and it has the thing judges reward above features — a *position*: refuse to accuse when you cannot be sure. The Magic Moment is real and deterministic.

**Why it could lose.** Five days is tight. The belt (Phase 6) and misattribution (Phase 5) are the risky components; if both slip, the demo degrades to "citation checker with an OCR badge," which is merely good.

**Biggest weakness.** Corpus coverage is historical. **Lead** the demonstration with the coverage boundary and turn it into the honesty story — a judge who finds the gap themselves scores it as a flaw; a judge shown it first scores it as maturity.

**The one move that most strengthens it.** Make **misattribution** the hero, not fabrication. Every competitor finds invented citations; nobody tells a lawyer *"your quote is real, you attributed it to the wrong case"* — and that is the failure that actually happens in practice.
