import { bindQuotations, parseCitations, parseQuotations } from "@/lib/resolve";
import { auditItem } from "@/lib/verdict";
import { Corpus, loadCoverageTable } from "@/lib/corpus";
import { beltConfigFromEnv, proposeAndVerify } from "@/lib/llm";
import type { VerifiedProposition } from "@/lib/llm";
import type { AuditItem } from "@/lib/types";
import { buildReport, propositionFor, type ReportBelt, type ReportBundle } from "./bundle";
import { putReport, reportId } from "./store";

/**
 * One audit, start to finish, for the report page.
 *
 * `lib/audit.ts` already sequences extraction -> resolution -> verdicts and is what the tests
 * exercise. This adds the three things only the UI needs: the belt (kept out of the engine on
 * purpose — `lib/verdict` must not be able to import `lib/llm`), the report bundle, and the store
 * write. It does not re-implement any adjudication.
 */

/**
 * Cap on audited lines.
 *
 * Not a performance guard: a guard against an unbounded document producing an unbounded number of
 * corpus lookups from an unauthenticated endpoint. Twelve covers the fixture brief twice over, and
 * a document that hits the cap says so on the page rather than quietly truncating.
 */
export const MAX_ITEMS = 12;

export interface RunAuditOptions {
  /** The belt is opt-in per run, because it is the only component that costs money. */
  belt?: boolean;
  maxItems?: number;
}

export interface RunAuditResult {
  bundle: ReportBundle;
  /** How many items the document produced BEFORE the cap. Drives the truncation notice. */
  itemsFound: number;
}

export async function runAudit(
  document: string,
  opts: RunAuditOptions = {},
): Promise<RunAuditResult> {
  const maxItems = opts.maxItems ?? MAX_ITEMS;
  const citations = parseCitations(document);
  const quotations = parseQuotations(document);
  const allItems: AuditItem[] = bindQuotations(citations, quotations);
  const items = allItems.slice(0, maxItems);

  // One corpus instance for the whole run, so `networkCalls()` is a real measurement of THIS audit
  // rather than of every audit the process has served.
  const corpus = new Corpus();
  // No `verbose` flag: `resolutionTrace` and `trueHomeCandidates` are produced unconditionally, and
  // the option that once gated them lives on `lib/audit.ts`'s wrapper rather than on `auditItem`.
  const results = await Promise.all(items.map((item) => auditItem(item, { corpus })));

  const belt = opts.belt === false ? null : await runBelt(document, items, results);
  const coverage = loadCoverageTable();
  const id = reportId(document);

  const bundle = buildReport({
    id,
    document,
    title: documentTitle(document),
    items,
    results,
    belt,
    meta: {
      auditedAt: new Date().toISOString(),
      itemsFound: allItems.length,
      networkCalls: corpus.networkCalls(),
      corpus: "Harvard Caselaw Access Project bulk static (static.case.law)",
      coverage: Object.entries(coverage.reporters)
        .map(([reporter, info]) => ({ reporter, latestDecisionDate: info.latestDecisionDate }))
        .filter((row) => Boolean(row.latestDecisionDate))
        .sort((a, b) => a.reporter.localeCompare(b.reporter)),
    },
  });

  putReport(bundle);
  return { bundle, itemsFound: allItems.length };
}

/**
 * The belt, run over the audited lines and verified by the Phase 4 matcher.
 *
 * The opinion handed to the model is the CITED case's, because the drafter's claim is about that
 * case. That is what makes the demo's closing beat work at all: on a misattributed line the cited
 * case does not contain the sentence, so the model is being asked to find support for a proposition
 * in an opinion that does not have it — and whatever it returns is then checked.
 *
 * Returns `null` when the belt is unconfigured, which is a legitimate deployment rather than an
 * error: the report then says the belt did not run, instead of implying the model found nothing.
 */
async function runBelt(
  document: string,
  items: readonly AuditItem[],
  results: readonly Awaited<ReturnType<typeof auditItem>>[],
): Promise<ReportBelt[] | null> {
  const config = beltConfigFromEnv();
  if (!config) return null;

  const attempts = await Promise.all(
    items.map(async (item, i) => {
      const cited = results[i]?.citedCase;
      const proposition = propositionFor(document, item.quotation.span);
      if (!cited?.text) {
        // Nothing to check the proposition against. Reported as `unavailable` with the reason, never
        // as a decline: "we did not ask" must not read as "the model found nothing".
        return unavailableBelt(
          "the cited case did not resolve to any opinion text, so there was nothing to check the proposition against.",
        );
      }
      const verified = await proposeAndVerify(cited.text, proposition, config);
      return toReportBelt(verified);
    }),
  );

  return attempts;
}

function toReportBelt(v: VerifiedProposition): ReportBelt {
  const attempt = v.attempt;
  return {
    status: v.verification.status,
    proposedSpan: attempt.proposal?.proposedSpan ?? null,
    verbatim: v.verification.verbatim ?? null,
    span: v.verification.span ?? null,
    selfReportedConfidence: v.verification.selfReportedConfidence ?? null,
    sharedRunWords: v.verification.sharedRunWords ?? null,
    sharedRunText: v.verification.sharedRunText ?? null,
    reason: v.verification.reason,
    provider: attempt.provider,
    model: attempt.model,
    seed: attempt.seed,
    promptVersion: attempt.promptVersion,
    generationId: attempt.generationId,
    costUsd: attempt.usage?.costUsd ?? null,
    latencyMs: attempt.latencyMs,
  };
}

function unavailableBelt(reason: string): ReportBelt {
  return {
    status: "unavailable",
    proposedSpan: null,
    verbatim: null,
    span: null,
    selfReportedConfidence: null,
    sharedRunWords: null,
    sharedRunText: null,
    reason,
    provider: null,
    model: null,
    seed: null,
    promptVersion: "",
    generationId: null,
    costUsd: null,
    latencyMs: null,
  };
}

/**
 * The document's title, taken from the document itself.
 *
 * A brief opens with a court caption — `IN THE UNITED STATES DISTRICT COURT / FOR THE NORTHERN
 * DISTRICT OF ILLINOIS` — so the first line is the WRONG title, and every real brief in this corpus
 * has that shape. The title is instead the document's own heading line when one is present: a short,
 * mostly-uppercase line naming what the document is (`DEFENDANT'S MOTION TO DISMISS`). Both paths
 * only ever copy words the document already contains — the alternative, generating a summary title,
 * would be the first place this tool invented something, on its own front page.
 */
const TITLE_WORDS =
  /\b(MOTION|MEMORANDUM|BRIEF|COMPLAINT|PETITION|ANSWER|RESPONSE|OPPOSITION|REPLY|AFFIDAVIT|DECLARATION)\b/;

/**
 * The title inside a caption line.
 *
 * A brief's caption is a table: the parties to the left, a column of `)`, and the document's own
 * name to the right — `v.                    )   DEFENDANT'S MOTION TO DISMISS`. The first version of
 * this returned the whole line, so the report page and the browser tab were headed
 * `v. ) DEFENDANT'S MOTION TO DISMISS`, which is the docket's shape rather than the document's name.
 * Measured on the fixture brief, in the served HTML.
 *
 * Returns `null` when there is nothing after the column, so a closing rule (`____ )`) is not mistaken
 * for a title.
 */
function tailAfterCaption(line: string): string | null {
  const collapsed = line.replace(/\s+/g, " ").trim();
  const close = collapsed.lastIndexOf(")");
  const tail = close === -1 ? collapsed : collapsed.slice(close + 1).trim();
  return tail.length >= 3 ? tail : null;
}

/** True when a line reads like a document's own heading rather than a sentence or a docket entry. */
function looksLikeHeading(line: string): boolean {
  return (
    line.length <= 90 &&
    !/[.!?]$/.test(line) &&
    TITLE_WORDS.test(line.toUpperCase()) &&
    uppercaseRatio(line) >= 0.6
  );
}

export function documentTitle(document: string): string {
  const lines = document.split("\n").slice(0, 30);

  for (let i = 0; i < lines.length; i++) {
    const tail = tailAfterCaption(lines[i]);
    if (!tail || !looksLikeHeading(tail)) continue;

    // The caption's title column WRAPS: the fixture brief reads `) DEFENDANT'S MOTION TO DISMISS`
    // then `) AND MEMORANDUM IN SUPPORT`. Taking only the first line truncated the name, so
    // continuation lines are joined while they are still part of the same table — contiguous, each
    // with its own `)` column, and each still reading as a heading. The table ends at a blank line or
    // at a line whose tail stops looking like a heading, which is where the parties resume.
    const parts = [tail];
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j];
      if (!raw.trim()) break;
      if (!raw.includes(")")) break;
      const next = tailAfterCaption(raw);
      if (!next || !looksLikeHeading(next)) break;
      parts.push(next);
    }
    return parts.join(" ");
  }

  const first = lines.find((l) => l.trim())?.replace(/\s+/g, " ").trim();
  if (first && first.length <= 90 && !/[.!?]$/.test(first) && !/[.]\s*\S/.test(first)) return first;

  const words = document.trim().split(/\s+/).slice(0, 8).join(" ");
  return words ? `${words}…` : "Untitled document";
}

function uppercaseRatio(line: string): number {
  const letters = line.replace(/[^A-Za-z]/g, "");
  if (!letters) return 0;
  return (line.match(/[A-Z]/g)?.length ?? 0) / letters.length;
}
