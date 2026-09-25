import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnnotatedBrief } from "@/components/AnnotatedBrief";
import { Masthead } from "@/components/Masthead";
import { VerdictTally } from "@/components/VerdictTally";
import { VERDICTS, VerdictMark, toneClass } from "@/components/verdict";
import type { ReportBundle, ReportItem, ReportSummary } from "@/lib/report/bundle";
import { getReport } from "@/lib/report/store";
import { MAX_ITEMS } from "@/lib/report/audit-run";
import styles from "./report.module.css";

/**
 * The margin-rail report view.
 *
 * A server component, because the report is already in this process: the POST that produced it
 * wrote it to the store, and `getReport` reads it back. That is why the opinions — 20–60KB each —
 * never cross the wire, and why the API key never has to leave the server to render a page whose
 * belt section was produced with it.
 *
 * `force-dynamic` is required rather than preferred. The store is in-process memory, so this route
 * has no cacheable input: a prerendered or cached render would serve a report for an id this
 * process may never have held, which presents as "that report does not exist" for the report the
 * reader just created.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const bundle = getReport(id);
  if (!bundle) return { title: "Report not found — CiteProof" };
  return {
    title: `${bundle.title} — CiteProof audit`,
    description: `${bundle.summary.total} citations audited: ${bundle.summary.positive} confirmed, ${bundle.summary.accusations} that name no case we can find, ${bundle.summary.refusals} we could not check.`,
  };
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = getReport(id);
  if (!bundle) notFound();

  const coverageEnd = latestCoverage(bundle);
  const dropped = bundle.meta.itemsFound - bundle.summary.total;

  return (
    <main className={styles.page}>
      <Masthead
        beltMode={bundle.summary.belt.ran ? "belt-enabled" : "deterministic-only"}
        coverageEnd={coverageEnd}
        headingLevel="div"
      />

      <div className={styles.titleBlock} data-ui="report-title">
        <h1 className={styles.title}>{bundle.title}</h1>
        <p className={styles.subtitle}>
          {bundle.summary.total} {bundle.summary.total === 1 ? "citation" : "citations"} audited ·{" "}
          {bundle.summary.belt.ran ? "proposer belt on" : "no model consulted"} ·{" "}
          {new Date(bundle.meta.auditedAt).toISOString().slice(0, 16).replace("T", " ")} UTC
        </p>
      </div>

      <div className={styles.tallyWrap}>
        <VerdictTally summary={bundle.summary} />
        <p className={styles.headline} data-ui="headline">
          {headline(bundle.summary)}
        </p>
      </div>

      {/*
        A document with no auditable citations is a legitimate outcome, and saying so is the honest
        report of it: the tool found nothing to check, which is a statement about the document, not a
        failure of the audit. Rendered as prose rather than as an error, and with the next step named.
      */}
      {bundle.summary.total === 0 ? (
        <section className={styles.empty} data-ui="empty-state">
          <p className={styles.emptyLead}>
            There is nothing in this document to check against primary law.
          </p>
          <p>
            The audit looks for two things: a case citation in a standard reporter format, and a
            quotation bound to one. This document contains neither — so there is no verdict here, and
            no finding either way. That is not the same as a clean audit.
          </p>
          <p>
            If the document does cite cases, the citations are most likely in a form the parser does
            not yet recognise, or the text arrived without them (a scanned PDF, or a paste that lost
            its footnotes). <Link href="/">Try another document</Link>.
          </p>
        </section>
      ) : (
        <>
          {/*
            Stated on the surface, not buried: a report that audited 12 of 30 citations and did not
            say so would be the exact silent omission this product exists to catch.
          */}
          {dropped > 0 && (
            <p className={styles.headline} data-ui="capped-notice">
              This document contains {bundle.meta.itemsFound} citations and this build audits up to{" "}
              {MAX_ITEMS} per run, so {dropped} {dropped === 1 ? "line is" : "lines are"} not shown
              below. Nothing here is a statement about {dropped === 1 ? "it" : "them"}.
            </p>
          )}

          <section className={styles.briefSection} aria-label="The audited document">
            <p className={styles.sectionLabel}>The document as audited</p>
            <AnnotatedBrief bundle={bundle} />
          </section>

          <section className={styles.findings} aria-label="Findings">
            <p className={styles.sectionLabel}>Each line, and what it was decided against</p>
            {bundle.items.map((item) => (
              <Finding key={item.id} item={item} />
            ))}
          </section>
        </>
      )}

      <footer className={styles.colophon} data-ui="colophon">
        <p className={styles.colophonHead}>How this was decided</p>
        <p>
          Every verdict above was decided by matching the document&apos;s own bytes against the
          opinion&apos;s own bytes, fetched from {bundle.meta.corpus}. No model decided any verdict:
          {bundle.summary.belt.ran
            ? " the proposer belt ran and every span it proposed was checked against the opinion text, but its output cannot move a verdict."
            : " no model was consulted on this run at all."}{" "}
          {bundle.meta.networkCalls === 0
            ? "This audit issued zero network requests."
            : `This audit issued ${bundle.meta.networkCalls} network ${bundle.meta.networkCalls === 1 ? "request" : "requests"}.`}
        </p>
        <p>
          The corpus ends at the date below. A refusal is not a finding: where a citation is newer
          than the corpus, or the scanned text is too degraded to read, the report says so rather
          than calling it invented. <Link href="/">Audit another document</Link>.
        </p>
        <p className={styles.coverage}>
          {bundle.meta.coverage.map((row) => (
            <span key={row.reporter}>
              <span className={styles.coverageReporter}>{row.reporter}</span> {row.latestDecisionDate}
              {"   "}
            </span>
          ))}
        </p>
      </footer>
    </main>
  );
}

// --- one finding ---------------------------------------------------------------

function Finding({ item }: { item: ReportItem }) {
  const style = VERDICTS[item.verdict];
  const excerptCase = item.excerptSide === "trueHome" ? item.trueHome : item.citedCase;
  const beltCost = item.belt?.costUsd ?? null;
  const hasMeta = Boolean(excerptCase) || beltCost !== null;

  return (
    <article className={styles.finding} id={`item-${item.id}`} data-ui={`finding ${item.verdict}`}>
      <div className={styles.findingRail}>
        <p className={styles.findingCite}>{collapse(item.citation.raw)}</p>
        <span className={`${styles.findingMark} ${toneClass(item.verdict)}`}>
          <VerdictMark verdict={item.verdict} size={15} />
          <span className={styles.findingLabel}>{style.label}</span>
        </span>
      </div>

      <div className={styles.findingBody}>
        <p className={styles.reason}>{item.reason}</p>

        {item.excerpt && (
          <blockquote className={styles.excerpt} data-ui="excerpt">
            <span className={styles.excerptCaption}>
              {item.excerptSide === "trueHome"
                ? "the case that actually contains it"
                : "the case you cited"}
              {excerptCase ? ` · ${collapse(excerptCase.citation)}` : ""}
              {item.opinionSpan ? ` · characters ${item.opinionSpan.start}–${item.opinionSpan.end}` : ""}
            </span>
            {item.excerpt.truncatedBefore && <span className={styles.ellipsis}>[…] </span>}
            {item.excerpt.before}
            <mark className={styles.excerptMark}>{item.excerpt.match}</mark>
            {item.excerpt.after}
            {item.excerpt.truncatedAfter && <span className={styles.ellipsis}> […]</span>}
          </blockquote>
        )}

        {hasMeta && (
          <p className={styles.meta} data-ui="finding-meta">
            {excerptCase && (
              <>
                <span>
                  <span className={styles.metaKey}>searched</span>{" "}
                  {excerptCase.characters.toLocaleString("en-US")} chars
                </span>
                <span>
                  <span className={styles.metaKey}>ocr</span> {excerptCase.ocrConfidence.toFixed(3)}
                </span>
              </>
            )}
            {beltCost !== null && (
              <span>
                <span className={styles.metaKey}>belt cost</span> ${beltCost.toFixed(6)}
              </span>
            )}
          </p>
        )}

        {/*
          The receipt. A verdict that does not say where its bytes came from is an assertion, so the
          link says which KIND it is: a direct case file we read, or a search that will find it.
        */}
        {excerptCase && (
          <p className={styles.source} data-ui="finding-source">
            <span className={styles.sourceKind}>
              {excerptCase.source.direct ? "read the case file" : "search the citation"}
            </span>{" "}
            <a href={excerptCase.source.href} rel="noreferrer noopener" target="_blank">
              {excerptCase.source.label}
            </a>
          </p>
        )}

        {item.verdict === "MISATTRIBUTED" && <TrueHome item={item} />}
        {item.verdict === "FABRICATED" && <Trace item={item} />}
        {item.belt && <Belt item={item} />}
      </div>
    </article>
  );
}

// --- MISATTRIBUTED: the true home, and the quoters that lost --------------------

function TrueHome({ item }: { item: ReportItem }) {
  const home = item.trueHome;
  if (!home) return null;
  const losers = item.trueHomeCandidates.slice(1);

  return (
    <div className={styles.home} data-ui="true-home">
      <p className={styles.homeHead}>
        {losers.length > 0 ? "Where it actually lives, and what else carries it" : "Where it actually lives"}
      </p>
      <p className={styles.homeName}>{home.caseNameFull || home.caseName}</p>
      <p className={styles.homeCite}>
        {collapse(home.citation)} · {home.court} · {home.decisionDate}
      </p>
      <p className={styles.source}>
        <a href={home.source.href} rel="noreferrer noopener" target="_blank">
          {home.source.label}
        </a>
      </p>

      {losers.length > 0 && (
        <>
          <ul className={styles.candidates} data-ui="true-home-candidates">
            {losers.map((c, i) => (
              <li className={styles.candidate} key={`${c.citation}-${i}`}>
                <span className={styles.candidateRank}>{i + 2}.</span>
                <span className={styles.candidateName}>{c.caseName}</span>
                <span className={styles.candidateCite}>
                  {collapse(c.citation)} · {c.decisionDate}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.rankNote}>
            Ranked by earliest publication date: the sentence has many homes and one origin, and a
            CourtListener hit reports the quoters, never the origin. The date is a proxy for origin,
            not proof of it — the full rule and its limits are in{" "}
            <span className="mono">docs/LIMITS.md</span> §12.
          </p>
        </>
      )}
    </div>
  );
}

// --- FABRICATED: the resolution receipt -----------------------------------------

function Trace({ item }: { item: ReportItem }) {
  if (item.trace.length === 0) return null;
  return (
    <ul className={styles.trace} data-ui="resolution-trace">
      {item.trace.map((step, i) => (
        <li className={styles.traceStep} key={`${step.source}-${i}`}>
          <span className={styles.traceSource}>{step.source}</span>
          <span className={styles.traceQuery}>{step.query}</span>
          <span className={step.outcome === "hit" ? undefined : styles.traceMiss}>{step.outcome}</span>
          {step.detail && <span className={styles.traceQuery}>— {step.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

// --- the belt -------------------------------------------------------------------

const BELT_HEAD: Record<string, { text: string; dot: string }> = {
  supported: { text: "proposed span supported — found in the cited opinion", dot: "dotSupported" },
  unsupported: { text: "proposed span NOT found in the cited opinion", dot: "dotUnsupported" },
  declined: { text: "the model returned no span", dot: "dotQuiet" },
  unavailable: { text: "the belt did not run", dot: "dotQuiet" },
};

/**
 * The belt, reported as a status rather than as a result.
 *
 * The four statuses are kept apart because collapsing them would be the whole failure this product
 * exists to catch: `declined` means the model answered and had nothing, `unavailable` means we never
 * asked, and "we never asked" must never read as "the model found nothing". Only `supported` and
 * `unsupported` are findings about the text.
 */
function Belt({ item }: { item: ReportItem }) {
  const belt = item.belt!;
  const head = BELT_HEAD[belt.status] ?? { text: belt.status, dot: "dotQuiet" };
  const quiet = belt.status !== "supported" && belt.status !== "unsupported";

  return (
    <div className={styles.belt} data-ui={`belt ${belt.status}`}>
      <p className={styles.beltHead}>
        <span className={`${styles.beltDot} ${styles[head.dot]}`} aria-hidden />
        proposer belt · {head.text}
      </p>
      <p className={styles.beltReason}>{belt.reason}</p>
      {belt.proposedSpan && (
        <p className={styles.beltProposal}>
          <span className={styles.beltProposalLabel}>what the model proposed</span>
          {belt.proposedSpan}
        </p>
      )}
      {!quiet && belt.verbatim && (
        <p className={styles.beltProposal}>
          <span className={styles.beltProposalLabel}>the opinion&apos;s own words at that span</span>
          {belt.verbatim}
        </p>
      )}
      {belt.model && (
        <p className={styles.meta}>
          <span>
            <span className={styles.metaKey}>model</span> {belt.model}
          </span>
          {belt.seed !== null && (
            <span>
              <span className={styles.metaKey}>seed</span> {belt.seed}
            </span>
          )}
          {belt.generationId && (
            <span>
              <span className={styles.metaKey}>generation</span> {belt.generationId}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

// --- prose ---------------------------------------------------------------------

/** Latest decision date the corpus can serve, over every reporter in the coverage table. */
function latestCoverage(bundle: ReportBundle): string | undefined {
  const dates = bundle.meta.coverage.map((row) => row.latestDecisionDate).sort();
  return dates.at(-1);
}

/**
 * One sentence stating what the audit found.
 *
 * Assembled from the counts rather than written by hand, so the sentence cannot contradict the tally
 * directly above it. The order is the product's argument: what was confirmed, then the sentence that
 * is real but in the wrong place (the thing no competitor ships), then the one accusation, then the
 * refusals — named last, and never dropped, because a report that omits its refusals is the report
 * this tool exists to catch.
 */
function headline(summary: ReportSummary): string {
  const c = summary.counts;
  const clause = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const clauses: string[] = [];

  if (c.VERIFIED) {
    clauses.push(clause(c.VERIFIED, "quotation is in the case it cites", "quotations are in the case they cite"));
  }
  if (c.MISATTRIBUTED) {
    clauses.push(
      clause(c.MISATTRIBUTED, "sentence is real but sits in a different case", "sentences are real but sit in a different case"),
    );
  }
  if (c.FABRICATED) {
    clauses.push(clause(c.FABRICATED, "citation names a case we cannot find", "citations name cases we cannot find"));
  }
  if (summary.refusals) {
    clauses.push(clause(summary.refusals, "could not be checked", "could not be checked"));
  }

  const total = `${summary.total} ${summary.total === 1 ? "citation" : "citations"} audited`;
  if (clauses.length === 0) return `${total}.`;
  if (clauses.length === 1) return `${total}: ${clauses[0]}.`;
  return `${total}: ${clauses.slice(0, -1).join(", ")} and ${clauses.at(-1)}.`;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
