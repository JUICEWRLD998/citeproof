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
| 19 | The mandated ≥0.92 fuzzy alignment works as specified | **FALSIFIED, then fixed** | Scored against a window longer than the quotation, padding counted as insertions: a 25-token passage with one word changed scored **0.36** and returned `null`, making the floor unreachable and the path dead code. `.recon/probe-fuzzy-threshold.mjs` also measured that **no ground-truth item exercises it at all** (true positives are exact `1.000`; nearest false candidate `0.447`). Fixed with fitting alignment; synthetic controls now exercise it. §10 |
| 20 | An in-coverage citation matching no case is sufficient to accuse | **FALSIFIED** | A truncated or failed volume index is indistinguishable from "no such case" at the call site, and `cache.ts` warns the index is the layer to distrust first. Accusation now requires a substantive index (`indexSize >= MIN_INDEX_FOR_ACCUSATION = 3`); below it the result is `UNVERIFIABLE_UNRESOLVED`. §11 |
| 21 | "Find a case containing the quotation" identifies where it lives | **FALSIFIED** | CourtListener reports **123 cases** containing Brown's holding, and its top hits are the cases that QUOTE it — Brown was not among them. A sentence has many homes and one origin, so the resolver must RANK. `.recon/probe-misattribution.mjs`. §12 |
| 22 | A quotation has one home, so ranking can be tested with the original corpus | **FALSIFIED** | The corpus held exactly ONE case containing the holding, so first-match and earliest-match were indistinguishable and ranking was untestable against reality. A real quoter (`671 F.3d 611`, McCauley v. City of Chicago, 7th Cir. 2011) was verified and added; the scan returns it FIRST, 57 years after the origin |
| 23 | A CourtListener hit can be reported as a true home | **FALSIFIED** | CL carries no opinion text (401 on `/opinions/<id>/`), so a hit is a lead. It becomes a candidate only after its citation resolves through CAP and the quotation is found verbatim there. A test feeds it Anderson — a real case that does NOT contain the holding — and asserts it is discarded. §13 |
| 24 | Exclusion by a case's canonical citation is sufficient | **FALSIFIED** | Citing Brown as `74 S. Ct. 686` (a parallel reporter) let Brown back into the candidate list, which would produce a `MISATTRIBUTED` naming the case already cited. Now matched against every citation a case carries |

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

### Phase 4 — complete, 2026-09-23 (receipts)

Built on branch `phase-4-verdicts`. Files: `lib/verdict/verdicts.ts`, `lib/verdict/ocr.ts`, `lib/match/misattribution.ts`, `tests/verdicts.test.ts`; modified `lib/verdict/index.ts`, `lib/match/match.ts`, `lib/corpus/index.ts`, `lib/resolve/cascade.ts`, `lib/types.ts`, `lib/audit.ts`, `fixtures/ground-truth.json`, `tests/ground-truth.test.ts`. New evidence: `.recon/probe-fuzzy-threshold.mjs`.

| Acceptance criterion | Result | Evidence |
|---|---|---|
| All four verdict branches reachable from fixtures | **PASS** | The real brief audits to **five** distinct verdicts: `VERIFIED` (347 U.S. 483, chars 9564–9619), `MISATTRIBUTED` (163 U.S. 537 → recovered to Brown at 9564–9619), `FABRICATED` (999 U.S. 1234), `UNVERIFIABLE_COVERAGE` (678 F. Supp. 3d 443), `UNVERIFIABLE_LOW_CONFIDENCE` (163 U.S. 537, OCR 0.434) |
| A correct quote from a 0.66-OCR case is **never** `FABRICATED` | **PASS** | Brown's holding comes back `VERIFIED` at OCR 0.664, below the 0.5 floor — asserted both as a pure precedence test and end to end. The gate is one-directional, and the direction is asserted at the boundary from both sides |
| Every verdict returns offsets + a reason string | **PASS** | Asserted for every item of the real brief: non-empty reason, and `foundInOpinion` present for every positive find. A `MISATTRIBUTED` result's offsets are checked to **contain the quotation in the true home's text**, not merely to be non-zero |
| Unit-tested against the `"separate educational..."` case-sensitivity trap | **PASS** | Lowercase returns `-1` from `indexOf`, 1 from the matcher; the returned span is asserted equal to the original capitalised bytes and to the frozen offset **9564** |
| OCR gate is a threshold with a **recorded number** | **PASS** | `OCR_CONFIDENCE_FLOOR = 0.5` pinned from both sides at ±0.0001, plus both measured anchors: Plessy `0.434` refuses, Brown `0.664` accuses. Recorded with its derivation in `lib/types.ts` and `docs/LIMITS.md` §6 |
| Typecheck / suite | **PASS** | `tsc --noEmit` exit 0; verdicts 44/44; full suite **183 passed / 1 todo** — the 13 Phase 4 stub failures are gone |

**Three findings worth the reader's time.**

**1. The fuzzy matcher was dead code, and no fixture could have caught it.** §3.5 mandates a ≥0.92 token-alignment stage. Scored as a plain edit distance against a window deliberately *longer* than the quotation, every padding token counted as an insertion: a genuine 25-token passage with one word changed scored **0.36** and the matcher returned `null`. `.recon/probe-fuzzy-threshold.mjs` measures why this stayed invisible — both true-positive fixtures are verbatim (`1.000`, exact path) and the nearest false candidate is E3's paraphrase at `0.447`, so **no ground-truth item exercises the fuzzy path at all**. Synthetic positive controls found it; the fix is fitting (semi-global) alignment, making the window's unaligned ends free. Recorded as `docs/LIMITS.md` §10.

**2. An empty volume index is not evidence of fabrication.** Phase 3's criterion that an unresolvable citation become `FABRICATED` was unmet, but refusing blindly is wrong in the other direction: a truncated or failed index is *indistinguishable* from "no such case" at the call site, and `lib/corpus/cache.ts` warns the index is the layer to distrust first. `CorpusError.Unresolved` now carries `indexSize`, and the split is made on evidence — a substantive index with no match accuses; an empty or near-empty one refuses. The threshold `MIN_INDEX_FOR_ACCUSATION = 3` is recorded in `lib/types.ts` with its derivation, chosen on the same asymmetry as the OCR floor. Recorded as §11.

**3. Ground truth had to state its own coordinates.** `tests/ground-truth.test.ts` derived them by splitting `citationRaw` on spaces, which yields reporter `"F."` and page `0` for `678 F. Supp. 3d 443` — so E4 would have been refused as *unparseable* rather than as out-of-coverage, and the test would have passed while asserting nothing. E3 also carried no asserted year, without which the Phase 3 projection cannot fire and the fabricated citation resolves by a different mechanism than the one under test. The fixture now records explicit coordinates, with the reason recorded here rather than the change being silent.

**A correction kept in place.** `.recon/probe-fuzzy-threshold.mjs` first used an Anderson holding written *from memory*, which scored `0.273` against the opinion — it was not in the corpus, and it silently zeroed the probe's true-positive column, making the sweep print `1/2` where it should have read `2/2`. That is this project's own failure mode committed inside its own evidence tooling. The control is now extracted from the raw fixture bytes, and the probe asserts its own extraction succeeded.

**Watch item addressed:** both thresholds are recorded numbers with derivations, each pinned from both sides in tests, so a silent change to either fails the build rather than quietly flipping verdicts.

---

### Phase 5 — Misattribution resolver · Day 3–4
**Goal:** given a sentence absent from the cited case, find where it actually lives.
**Tasks:** local-cache scan first, then a single budgeted CL search · rank candidates · render a side-by-side diff.
**Files:** `lib/match/misattribution.ts`, `tests/misattribution.test.ts`
**Acceptance:** the fixture sentence planted in the wrong case is recovered to its true home with a deep link; a genuinely invented sentence returns no candidate and stays `FABRICATED`.
**Watch:** this is the differentiator — protect this phase's time. A false "found it elsewhere" is worse than no feature; require an exact normalised match before claiming a new home.

### Phase 5 — complete, 2026-09-23 (receipts)

Built on branch `phase-5-misattribution`. Files: `lib/match/cl-candidates.ts`, `tests/misattribution.test.ts`, `fixtures/corpus/f3d-671-0611-01.json`; modified `lib/match/misattribution.ts`, `lib/match/index.ts`, `lib/verdict/index.ts`, `lib/resolve/cascade.ts`, `lib/types.ts`, `tests/verdicts.test.ts`. New evidence: `.recon/probe-misattribution.mjs`, `.recon/find-brow-quoter.mjs`, `.recon/add-quoter-fixture.mjs`.

| Acceptance criterion | Result | Evidence |
|---|---|---|
| The fixture sentence is recovered to its true home with a deep link | **PASS** | E2 (`163 U.S. 537` + Brown's holding) returns `MISATTRIBUTED` with true home **347 U.S. 483**, offset **9564–9619**, asserted to slice the true home's text to exactly the holding |
| A genuinely invented sentence returns no candidate and stays `FABRICATED` | **PASS, via the low-confidence gate** | E5 returns no candidate from any source and lands on `UNVERIFIABLE_LOW_CONFIDENCE` — the correct refusal for a Plessy-cited line at OCR 0.434. (The fixture is E5, not E3; E3's fabricated line is separately asserted to produce no home and reach `FABRICATED` by the projection path.) |
| Local-cache scan first, then a single budgeted CL search | **PASS** | The local scan runs first and in this build resolves E2 completely; the CL stage is off unless enabled and, when on, issues **exactly one** query per item — asserted by counter |
| Rank candidates | **PASS** | Ranks all exact candidates, earliest published first; newest fixture makes this testable against reality (see below) |
| Render a side-by-side diff | **DEFERRED to Phase 7** | The engine supplies what the diff needs and `trueHomeCandidates` carries each candidate's **own text**; the rendering is UI work |
| Typecheck / suite | **PASS** | `tsc --noEmit` exit 0; misattribution 33/33; full suite **217 passed / 1 todo**; duration down to 7.3s |

**The phase's real finding: ranking is load-bearing, and the corpus had to grow to prove it.**

`.recon/probe-misattribution.mjs` measured that CourtListener reports **123 cases** containing Brown's holding — and that its top hits are the cases that QUOTE it (`570 U.S. 297`, `51 F.3d 440`, `671 F.3d 611`), with Brown not among them. So "find a case containing the sentence" is trivial and wrong; the resolver's job is to find the case it **originated** in.

Before this phase the local corpus held exactly **one** case containing that sentence, so "first match" and "earliest match" were indistinguishable and ranking could not be tested against reality at all. `.recon/find-brow-quoter.mjs` searched for a real quoter and `.recon/add-quoter-fixture.mjs` added **McCauley v. City of Chicago, 671 F.3d 611 (7th Cir. 2011)**, verified to contain the holding byte-for-byte. The corpus now holds two real cases containing it, **57 years apart** — and the scan returns the 2011 quoter *first*, so a test asserts that a first-match resolver would get it wrong while the ranker gets it right.

That fixture is added by its own idempotent script rather than by extending `fetch-fixtures.mjs`, because the three original fixtures are frozen against `foundAtCharOffset: 9564` and regenerating them from the network would move an offset the whole UI deep-links to.

**A deliberate limitation, not an oversight.** The rule is **earliest publication date wins**, and that is a *proxy for origin, not proof of it*. The decisive evidence would be the citation graph — a case listing the other's citation in its own `cites_to` is demonstrably quoting it — and the curated fixtures do not carry `cites_to`. So the resolver reports which candidate it believes is the origin and shows the others beside it; it does not claim to have established the direction of quotation. Recorded as `docs/LIMITS.md` §12.

**Two bugs found, both by tests written to fail in the right direction.**

1. **Exclusion ignored parallel citations.** `scanForTrueHome` compared the exclusion set only against a case's canonical citation, so a document citing Brown as `74 S. Ct. 686` would let Brown back in through a reporter alias and produce a `MISATTRIBUTED` verdict naming the very case it had already cited. Now matched against every citation the case carries, with tests asserting the canonical and parallel spellings behave identically.

2. **Two CourtListener queries per audited item.** A test asserting "one search per call" failed with `1` where the test wanted `0` for a `VERIFIED` line — revealing that the cascade's enrichment and the new candidate-discovery stage were each issuing their own query: **two requests per item** against an anonymous budget of roughly 5/minute, which does not survive a brief with more than two lines. The cascade now returns its hits via `CascadeOutcome.crossCheckHits` and the verdict layer mines those. One search per item, reused.

**And one piece of waste removed.** The true-home scan ran the fuzzy window search over every ~60KB opinion and then **discarded every fuzzy hit**, because the ranker requires exact — 524ms per call (measured with a scratch harness, since deleted), and the `exact` flag it populated was always `true` by the time any caller read it. Replaced with the exact substring matcher. The suite went from ~30s of cascading 5s timeouts to **7.3s**.

**Watch item honoured:** every candidate source passes through the exact matcher, and `findTrueHome`/`rankTrueHomes` have no path that can name a fuzzy home. Tests feed the resolver a near-miss, a real-but-wrong case (Anderson, which does *not* contain the holding), an uncited CL hit, and an unreachable citation — and assert each yields no home.

---

### Phase 6 — Proposition belt + self-verification · Day 4
**Goal:** LLM proposes a supporting span; our matcher adjudicates it.
**Tasks:** OpenRouter client (`lib/llm/openrouter.ts`) with `response_format: json_schema`, `temperature: 0`, **pinned `seed`** · prompt returns a span only · **span is verified by the Phase-4 matcher** · record seed + prompt version in the fixture · cost logging from the response usage block.
**Files:** `lib/llm/openrouter.ts`, `lib/llm/proposition.ts`, `lib/llm/selfverify.ts`, `tests/selfverify.test.ts`
**Acceptance:** a stubbed model response citing a span that is **not** in the opinion is caught and reported as an unsupported span; a real span passes; identical seed ⇒ identical output across runs; the key is read server-side only and never reaches the client bundle (assert by grepping the built client output for the key).
**Watch:** the belt must have a **no-key path** — if `OPENROUTER_API_KEY` is absent the app degrades to Phases 1–5 and still audits. Never let the demo depend on the belt being up.

### Phase 6 — complete, 2026-09-24 (receipts)

Built on branch `phase-6-belt`. Files: `lib/llm/openrouter.ts`, `lib/llm/proposition.ts`, `lib/llm/selfverify.ts`, `lib/llm/index.ts`, `tests/selfverify.test.ts`, `tests/belt-record.test.ts`, `tests/helpers/env.ts`, `vitest.config.ts`. Evidence: `.recon/probe-seed-determinism.mjs`, `.recon/probe-provider-stability.mjs`, `.recon/probe-belt-diagnostics.mjs`, and the recorded live run `fixtures/belt-run.json`.

| Acceptance criterion | Result | Evidence |
|---|---|---|
| A stubbed model response citing a span **not** in the opinion is caught, and reported as an unsupported span | **PASS** | End to end through the client with a stubbed 200: the fabricated span comes back `unsupported`, never `supported`. A span from a *different* opinion is caught too, so cross-case leakage cannot pass as support |
| A real span passes | **PASS** | The holding proposed with different whitespace and typographic quotes is located and the **opinion's own bytes** are returned, not the model's rendering; the frozen ground-truth offset `9564` is reproduced from a proposal |
| Identical seed ⇒ identical output across runs | **PASS** | **5/5 byte-identical** live requests on 2026-09-23 and again **5/5 on 2026-09-24**, all served by the pinned provider (`fixtures/belt-run.json`, generation ids recorded); the opt-in live test confirms it a third time. The pinning is part of the claim — see below |
| The key is read server-side only and never reaches the client bundle | **PASS** | The bundle grep runs for real against a fresh `next build` and is **proven able to fail**: planting the actual key into a client chunk made it fail naming `.next/static/chunks/0bma92pht_c97.js`, and the clean rebuild passes with no skip warning; a planted `openrouter.ai/api/v1` literal was likewise caught naming the chunk, and a client component importing `lib/llm` fails the build outright |
| Watch item: the no-key path degrades and still audits | **PASS** | With no key, `unavailable`, **zero requests issued** — asserted by a counter, not by absence of a crash. `unavailable` and `declined` are separate statuses, because *"we never asked"* must never read as *"the model found nothing"* |
| Typecheck / suite / build | **PASS** | `tsc --noEmit` exit 0; `next build` exit 0 (Turbopack, 23.9s); suite **252 passed / 2 skipped / 1 todo** in 7.9s. Both skips are the deliberate `RUN_LIVE_BELT` opt-in cases; the todo is still E6 |
| Task: record seed + prompt version in the fixture | **PASS** | `fixtures/belt-run.json` — written only after every claim about the run asserts: seed, temperature, prompt version, model, provider, the proposed span, its verified offsets, generation ids, cost, and the decline control. `tests/selfverify.test.ts` re-matches the recorded span against the corpus fixture and checks the constants, so the artifact fails the build when it rots |

**The phase's real finding: the determinism claim was a routing coincidence until it was pinned.** The plan asserts `seed` + `temperature: 0` makes the belt "reproducible on camera", and the first probe agreed — 5/5 byte-identical. It also showed all five were served by **Google**, which is the confound: `seed` is a per-provider parameter and OpenRouter load-balances across providers, so those runs proved the seed works *there*, not that a request routed elsewhere would agree. `.recon/probe-provider-stability.mjs` then confirmed the provider can be pinned (`order` + `allow_fallbacks: false`), so the client **pins by default**. "The demo replays identically" is therefore a claim about a pinned configuration, not about the API — and the recorded fixture names the provider for exactly that reason.

**Cost is a reported number, and it moves.** `usage.cost` varies between *identical* calls — measured **$0.000505 to $0.001884** — because prompt caching changes the input cost. So cost is logged from the response and never computed from a price table, and a response without a cost records `null` rather than a guess. The whole Phase 6 record (5 identical runs + the decline control) cost **$0.006905**, ≈$0.00115 per call on a 26.8k-character opinion: roughly an order of magnitude under §3.3's $0.013/citation estimate, which was derived from the price list without caching.

**The diagnostic that didn't work.** When a proposal is rejected, the belt says *how* it was wrong, because "the model paraphrased a real sentence" and "the model produced text that appears nowhere" are different problems with different fixes. The first implementation compared similarity against the opinion, and `.recon/probe-belt-diagnostics.mjs` measured that it separates nothing: a real sentence the model **extended** scored 0.400 — the same as a **fully invented** one — and nothing realistic reached the 0.92 floor at all, leaving the paraphrase branch as dead code. The **longest contiguous verbatim run** does separate them (real reproduction 5–12 words, incidental overlap 0–2), so `MIN_VERBATIM_RUN_TOKENS = 4` sits in the empty gap. It decides only how a rejection is *worded*, never whether a span is accepted — and the one genuinely murky case is named in the constant rather than hidden. Recorded as §14 of `docs/LIMITS.md`.

**Three bugs, and two were found by tests written to fail in the right direction.**

1. **The key leaked into the result.** HTTP error bodies and unparseable-content bodies were echoed into the attempt's `detail` — and `detail` travels into the audit result served to the client. A gateway, a proxy error page or a debug endpoint can echo request headers, so nothing may assume a response *won't* contain the key. `scrubKey` now removes the key, a Bearer-prefixed echo, and a truncated tail from every byte of response text before it is used in a message; a canary test asserts a 500 echoing the key produces no result containing it.
2. **The rejection diagnostic was dead code** — the previous section.
3. **A from-memory control, again.** A test asserted an Anderson sentence written from recollection; it is not in the Anderson opinion. That is Phase 4's probe trap repeated inside Phase 6's test suite. The control is now extracted from the fixture bytes, with an assertion that the extraction succeeded and that the sentence is genuinely absent from Brown — otherwise it would prove nothing.

**A security check that could pass without running, found while finishing the phase.** The bundle grep resolved the key from `process.env` only — but vitest does not load `.env` and Next.js does, so on the developer machine the check found no key, warned, and reported green. That is the same family as bug 1: a containment claim with no containment behind it. The test now assembles the environment the way Next.js does (`tests/helpers/env.ts`), so a build with a key configured **must** actually grep, and the only quiet path left is a build with no key at all — reported as vacuous rather than as passed.

**One flake, diagnosed rather than retried.** A suite run produced four spurious `Test timed out in 5000ms` failures in the misattribution scans and the next run produced none: the dev machine is a 4GB laptop that had ~200MB free, so the true-home scan over every cached ~60KB opinion exceeded 5s while ten workers shared it. `testTimeout` is now 30s in `vitest.config.ts` with that measurement as the stated reason — a hang detector, not a performance target, since the suite completes in ~8s.

**Watch item honoured:** the belt is structurally advisory. `lib/verdict` does not import `lib/llm` at all — asserted, not assumed — so no proposal can move a verdict, and an audit with no key is identical to an audit with one except for the belt's own section.

### Phase 7 — UI · Day 4
**Goal:** the §5 design system, browser-verified.
**Tasks:** tokens + DM Sans Variable + DM Mono · the margin-rail report view · verdict glyphs as inline SVG · empty/loading/error states written as a person would · the strike-through animation · `docs/DESIGN.md` with measured contrast ratios.
**Files:** `app/page.tsx`, `app/report/[id]/page.tsx`, `app/globals.css`, `styles/tokens.css`, `components/*.module.css`, `docs/DESIGN.md`, `.recon/driver.mjs`
**Acceptance:** screenshots of (a) a full report, (b) the `UNVERIFIABLE` row, (c) tab focus order · computed `font-weight` on headings is **exactly 550** · every fg/bg pair's WCAG ratio written down · one accent moment per screen · `prefers-reduced-motion` disables all motion · the margin rail aligns with the document at 375px width with no horizontal scroll.
**Watch:** verify by screenshot, never by grepping built HTML for class names — that cannot detect a control rendered in its own background colour.

### Phase 7 — complete, 2026-09-25 (receipts)

Built on branch `phase-7-ui`. The engine produced verdicts and nothing rendered them; this phase is the layer between, the report page, the audit input, and the instruments that check both.

**Files.** `app/report/[id]/page.tsx` + `report.module.css` · `app/page.tsx` + `page.module.css` · `app/api/audit/route.ts` · `components/{AuditForm,Masthead,AnnotatedBrief,VerdictTally,verdict}.tsx` + their `.module.css` · `lib/report/{audit-run,bundle,sources,store}.ts` · `tests/report.test.ts` · `docs/DESIGN.md` · `.recon/driver.mjs` · `.recon/contrast.mjs` · `styles/tokens.css` · `app/globals.css` · `vitest.config.ts`

| Acceptance criterion | Result | Evidence |
|---|---|---|
| Screenshots of (a) a full report, (b) the `UNVERIFIABLE` row, (c) tab focus order | **PASS** | `.recon/shots/report-light.png`, `report-unverifiable.png`, `landing-light.png`, `report-dark.png`, `report-375.png`. The driver drives the real flow — lands on `/`, fills the sample brief, runs the audit through `app/api/audit`, lands on `/report/6d3935272129` — and screenshots each state. Tab order is dispatched as real `Input.dispatchKeyEvent` Tab presses, because `:focus-visible` only applies when focus arrived from the keyboard and `el.focus()` would measure a ring the user never sees |
| Computed `font-weight` on headings is **exactly 550** | **PASS, with one named exception** | Every sans heading computes 550 or the hero/wordmark step (650 / 750); **mono micro-label headings compute 500, and that is correct** — DM Mono ships 400/500 only, so 550 would make the browser synthesise a weight that does not exist. The driver asserts the census, not a single heading, and the exception is in the assertion rather than in a comment |
| Every fg/bg pair's WCAG ratio written down | **PASS** | `docs/DESIGN.md` §2 — **24 pairs in light mode and 24 in dark**, all passing, produced by `.recon/contrast.mjs`, which now **parses `styles/tokens.css`** instead of holding its own copy of the palette |
| One accent moment per screen | **PASS** | Measured by counting computed `background-color` values, never by class names: **1 on the landing page** and it is the audit control; **0 on the report page**. A class-name grep could not detect a control rendered in its own background colour, which is the failure this check exists for |
| `prefers-reduced-motion` disables all motion | **PASS** | Measured **on the report page, where the animation actually is**: the strike's `animation-duration` drops to `1e-05s` and **zero** elements retain a live transition. The mark is **not** lost — the drawn rule and the text-decoration both survive, so reduced motion removes the movement rather than the finding |
| The margin rail aligns at 375px with no horizontal scroll | **PASS** | No horizontal overflow at 1280 (both modes), 375 (both pages). The rail's five entries all wrap to the same line count and all five marks sit at the same offset from their row |
| Typecheck / suite / build | **PASS** | `tsc --noEmit` exit 0 · `next build` exit 0 · suite **278 passed / 2 skipped / 1 todo** in 9.5s · driver **51/51** · contrast **48/48 pairs**, both invariants hold, positive control passes |

**The phase's real finding: the instruments were reading a transcription of the design, not the design.** `.recon/contrast.mjs` kept its own table of hex values and solved for compliant ones. `tokens.css` then adopted the solved values — and the tool went on reporting the *old* ones as current: `muted #777970 4.12:1` while the file shipped `#6f7169`. Nothing failed, because a palette check that reads a copy of the palette verifies the copy. It now parses the stylesheet, and the two cannot disagree. Same family as the bundle grep that resolved the key from `process.env` only: a containment claim with no containment behind it.

**Three colour failures it then caught, all in the file rather than in the checker.**

1. **`--surface-sunken` could not carry its own text.** At `#f2f1ec` it measured `--muted` **4.38:1** (needs 4.5), `--faint` **2.94:1** (needs 3.0) and `--accent-ink` **4.32:1** (needs 4.5) — three silent failures under every word set on the true-home panel, the belt block and the candidate rows. `--paper` is already near the top of the range, so there is almost no room to darken before text starts losing contrast. The token is **deleted**, not adjusted, and panels go the other way — `--surface` is *lighter* than paper, which raises contrast instead of eating it.
2. **The `UNVERIFIABLE` underline was a hairline tone.** It drew in `--line-strong` at **1.47:1**. An underline that is the only thing distinguishing one verdict state from another is a non-text UI component under WCAG 1.4.11 and needs 3:1. It now uses `--muted` (4.62:1), which also unified the mark — underline, glyph and label are one quiet value.
3. **`--line-strong` was re-solved rather than reassigned.** Once it had to carry a 3:1 boundary, `#cfcec6` was walked down in HSL preserving hue and saturation to `#8d8b79` — **3.21:1** on paper, **3.41:1** on a panel; dark mode went to `#767166` (**3.58:1**). The warm cast survives the correction.

**Five rendering defects, each found by looking rather than by grepping.**

1. **The report was titled `v. ) DEFENDANT'S MOTION TO DISMISS`.** A brief's caption is a table — parties left, a column of `)`, the document's name right — and `documentTitle` returned the whole line, so the page and the browser tab were headed with the docket's shape. The title is now what follows the last `)`, joined across the caption's wrapped continuation lines, because the fixture's name spans two of them.
2. **The landing page had no `h1`.** The wordmark was a plain link inside the header, so the first heading on the page was an `h2` — a real outline defect that a screenshot cannot show.
3. **…and then its `h1` computed 400 while the wordmark inside it rendered 750.** The heading was a wrapper that reset its own typography to `inherit` with the styled link inside. The heading is now the wordmark's own box with the link inside it, so the element and the visible text cannot disagree. This is the same class as the checklist item the plan already records: a page can look right and be wrong.
4. **`.field:focus { outline: none }` deleted the focus ring on the textarea** and substituted a border-colour change. The project's own rule is that focus is restyled, never removed; the field now carries the page's standard ring like every other control.
5. **375px overflowed to 379px, caused by the brief's signature rule** — 35 underscores, one token, no break opportunity. `overflow-wrap: anywhere` (not `break-word`: `anywhere` counts the broken token toward min-content, which is what lets the grid track shrink) plus `min-width: 0` on the grid items. The driver named the offending element rather than only reporting the overflow.

**A sixth defect the screenshot caught and the checks did not.** The verdict legend used `auto-fit`, which gave **four columns**, so the second row held two items and the container's hairline background showed through two empty cells as grey boxes. It is now a fixed 3-up grid — which also states the structure the design argues for, since row one is the three verdicts that decide and row two is the three that refuse.

**Six of the driver's own checks were wrong, and each is recorded because a lying probe is worse than no probe.**

1. **`cs = (el) => getComputedStyle(el)` silently dropped the pseudo-element argument.** `cs(el, '::after')` measured the *element*, so the strike rule was reported as `content: normal, background: rgba(0,0,0,0)` — "the animation does not exist" — against CSS that was correct and visibly rendering.
2. **`[data-ui^="finding"]` over-matched**, counting `finding-meta` and `finding-source` as findings: **11 findings on a 5-finding report.**
3. **`[data-ui^="belt"]` matched the masthead's `belt-status` fact**, reporting a belt section on a run where the belt was off — a false pass on the one check that proves no proposal can move a verdict.
4. **The primary button was measured while disabled**, so the probe reported "not accented" against a button that was merely empty. It is now measured with the field populated.
5. **`strikeDuration === "0s"` failed a working rule**: Chrome serialises the reduced-motion `0.01ms` override as `1e-05s`. The check now compares the numeric value, never its serialisation.
6. **`process.exit()` discarded the driver's output.** Writing to a file makes stdout async, so `node .recon/driver.mjs > report.txt` produced a file containing one line while the identical run through a TTY printed everything — earlier runs only looked fine because they were piped through `tail`. The exit is now deferred and Node is left to flush.

**Two process failures, both worth more than the bugs they caused.** First, **two driver runs reported failures against a build that had already been corrected**, because `next start` was serving the previous build — the stale-server trap the global notes already record, in a new place. The driver's own protocol now says to `curl` the served CSS chunk and confirm the new value is in it before believing a failure. Second, **a backtick inside a probe's comment terminated the template literal** four times in a row, and one of those was hidden behind an `&&` chain so the failed syntax check did not stop the run. Probes are template literals; their comments are string content, and `node --check` is now run as its own command.

**Watch item honoured:** every check that could pass without running was removed or given a positive control. The weight census excludes its own planted nodes; the planted 550/400/500/700 controls must read back distinctly or the whole run is discarded and says so; the contrast checker plants five failures that must be flagged and one good pair that must pass. Two checks were deleted outright rather than fixed, because they were asserting a preference rather than a requirement: "no rail citation wraps to two lines" (uniform wrapping is the requirement, and it is what the rhythm actually needs) and "the strike is drawn under reduced motion" measured on a page that has no strike rule.

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
fixtures/               briefs + ground-truth.json + belt-run.json  (tests read only these)
tests/                  vitest — normalisation traps + all verdict branches
tests/helpers/          shared test utilities (env loading for the bundle grep)
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
| 3 | 4, 5 | ✅ All four verdict branches reachable; ✅ misattribution ranked, verified, and recovered to the true home |
| 4 | 6, 7 | ✅ Belt self-verifies (determinism pinned, key contained, no-key path asserted); UI screenshotted and contrast-measured |
| 5 | 8 | Live URL + video + README + submitted |

**Progress note (2026-09-23).** Phases 0–5 are complete and merged; `main` carries all five. The full suite is **217 passed / 1 todo** at 7.3s, and the one `it.todo` is E6, which stays visible deliberately because its verdict definition (`docs/LIMITS.md` §4) is still an open question rather than an oversight. Remaining: Phases 6–8, plus the open parameters the plan intends to leave open — E6's definition (§4), the OCR floor's calibration (§6), the fuzzy floor's unmeasured false-positive rate (§10), `MIN_INDEX_FOR_ACCUSATION` (§11), and the date-proxy ranking rule, which is a proxy for origin rather than proof of it (§12).

**Progress note (2026-09-24).** **Phases 0–6 are complete and merged; `main` carries all six.** The suite is **252 passed / 2 skipped / 1 todo** in 7.9s, `tsc --noEmit` and `next build` both exit 0. The two skips are the deliberate `RUN_LIVE_BELT` opt-in cases (`tests/selfverify.test.ts` for live determinism, `tests/belt-record.test.ts` for the fixture recorder) — run both before the demo, since each needs the real API to mean anything. Phase 6's acceptance is met against a **fresh build**, because the bundle grep is only worth what the build it reads is worth. The one `it.todo` is still E6.

Phase 6 changed two things about the plan itself, and both are corrections rather than additions: the determinism claim holds only **under provider pinning** (§3.3 assumed the seed alone was enough), and the belt's measured cost is ≈**$0.00115/call** against §3.3's $0.013/citation estimate, because prompt caching moves the input cost and the estimate came from the price list. Both are recorded in `docs/LIMITS.md` §14 rather than smoothed over.

Remaining: **Phase 8 only**, plus the open parameters the plan intends to leave open — E6's definition (§4), the OCR floor's calibration (§6), the fuzzy floor's unmeasured false-positive rate (§10), `MIN_INDEX_FOR_ACCUSATION` (§11), the date-proxy ranking rule (§12), and the belt's unmeasured accuracy (§14).

**Progress note (2026-09-25).** **Phases 0–7 are complete and merged; `main` carries all seven.** The suite is **278 passed / 2 skipped / 1 todo** in 9.5s, `tsc --noEmit` and `next build` both exit 0, and the two instruments are green against a **fresh build**: `.recon/driver.mjs` **51/51** driving real Chrome over CDP through the real audit flow, and `.recon/contrast.mjs` **48/48 pairs** with both invariants holding and its positive control passing. The two skips remain the deliberate `RUN_LIVE_BELT` opt-in cases, which need the real API to mean anything and should be run before the demo; the one `it.todo` is still E6.

Phase 7 changed the design token file rather than only adding to it, and all three changes are corrections: `--surface-sunken` is **deleted** because it could not carry its own text at any of its targets, the `UNVERIFIABLE` underline moved off the hairline tone that measured 1.47:1 against a 3:1 requirement, and `--line-strong` was **re-solved** to `#8d8b79` so it can carry the control boundaries that depend on it. Each is recorded in `docs/DESIGN.md` with the ratio that forced it. The phase's most useful finding is about the instruments, not the palette: the contrast checker had been verifying a *copy* of the palette rather than the palette, so it went on reporting a `muted` value the stylesheet had already replaced.

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
