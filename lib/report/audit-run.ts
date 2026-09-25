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
  const results = await Promise.all(items.map((item) => auditItem(item, { corpus, verbose: true })));

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

export function documentTitle(document: string): string {
  const lines = document
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 24);

  const heading = lines.find(
    (l) =>
      l.length <= 90 &&
      !/[.!?]$/.test(l) &&
      TITLE_WORDS.test(l.toUpperCase()) &&
      uppercaseRatio(l) >= 0.6,
  );
  if (heading) return heading;

  const first = lines[0];
  if (first && first.length <= 90 && !/[.!?]$/.test(first) && !/[.]\s*\S/.test(first)) return first;

  const words = document.trim().split(/\s+/).slice(0, 8).join(" ");
  return words ? `${words}…` : "Untitled document";
}

function uppercaseRatio(line: string): number {
  const letters = line.replace(/[^A-Za-z]/g, "");
  if (!letters) return 0;
  return (line.match(/[A-Z]/g)?.length ?? 0) / letters.length;
}
