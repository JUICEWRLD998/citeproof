import type { ReportBundle, ReportItem } from "@/lib/report/bundle";
import { VERDICTS, VerdictMark, markClass, toneClass } from "./verdict";
import styles from "./AnnotatedBrief.module.css";

/**
 * The annotated brief — the document itself, with a margin.
 *
 * This is the one boldness, spent once per screen, and everything else on the page is arranged
 * around it. The document is the hero: not a list of findings beside a summary of the brief, but the
 * brief's own text with its citations and quotations marked in place, and a rail down the left
 * holding the reporter citation and the verdict for each marked line.
 *
 * Every mark is positioned by an offset the parser measured against these exact bytes —
 * `tests/report.test.ts` asserts the round-trip, because a mark drawn one character off would render
 * a plausible, confident, wrong document, which is the failure this product exists to catch.
 */
export function AnnotatedBrief({ bundle }: { bundle: ReportBundle }) {
  const byId = new Map(bundle.items.map((i) => [i.id, i]));

  return (
    <div className={styles.sheet} data-ui="annotated-brief">
      {bundle.rows.map((row, i) => {
        const entries = row.itemIds.map((id) => byId.get(id)).filter(Boolean) as ReportItem[];
        return (
          <div className={styles.row} key={`${row.start}-${i}`} data-ui="brief-row">
            <div className={styles.rail} data-ui="rail">
              {entries.map((item) => (
                <a
                  key={item.id}
                  href={`#item-${item.id}`}
                  className={styles.entry}
                  data-ui={`rail-entry ${item.verdict}`}
                  data-item-id={item.id}
                >
                  <span className={styles.entryCite}>{collapse(item.citation.raw)}</span>
                  <span className={`${styles.entryMark} ${toneClass(item.verdict)}`}>
                    <VerdictMark verdict={item.verdict} size={14} />
                    <span className={styles.entryLabel}>{VERDICTS[item.verdict].label}</span>
                  </span>
                </a>
              ))}
            </div>

            <p className={styles.paragraph}>
              {row.segments.map((seg, j) => {
                if (seg.kind === "text") return <span key={j}>{seg.text}</span>;
                if (seg.kind === "citation") {
                  return (
                    <span
                      key={j}
                      className={styles.citeMark}
                      data-ui="citation-mark"
                      data-item-id={seg.itemId}
                    >
                      {seg.text}
                    </span>
                  );
                }
                const item = byId.get(seg.itemId)!;
                return (
                  <span
                    key={j}
                    className={`${styles.quoteMark} ${markClass(item.verdict)}`}
                    data-ui={`quote-mark ${item.verdict}`}
                    data-item-id={seg.itemId}
                    title={`${VERDICTS[item.verdict].label} — ${VERDICTS[item.verdict].meaning}`}
                  >
                    {seg.text}
                  </span>
                );
              })}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** Citations arrive wrapped by the drafter's line breaks; the rail shows them as one line. */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
