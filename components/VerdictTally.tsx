import type { ReportSummary } from "@/lib/report/bundle";
import { VERDICTS, VerdictMark, toneClass } from "./verdict";
import type { Verdict } from "@/lib/types";
import styles from "./VerdictTally.module.css";

const ORDER: Verdict[] = [
  "VERIFIED",
  "MISATTRIBUTED",
  "FABRICATED",
  "UNVERIFIABLE_COVERAGE",
  "UNVERIFIABLE_LOW_CONFIDENCE",
  "UNVERIFIABLE_UNRESOLVED",
];

/**
 * The tally.
 *
 * All six verdicts are always shown, including the ones that did not occur, with a zero. A tally
 * that lists only what was found hides the shape of the audit: on the fixture brief, one accusation
 * beside one refusal is a fact about the corpus as much as about the brief, and a reader cannot see
 * that if the empty rows are removed.
 *
 * The counts are the only place numbers are set large. The verdict word is what carries meaning; the
 * number is the summary a reader skims.
 */
export function VerdictTally({ summary }: { summary: ReportSummary }) {
  return (
    <div className={styles.tally} data-ui="verdict-tally" role="group" aria-label="Verdict tally">
      {ORDER.map((verdict) => {
        const count = summary.counts[verdict];
        return (
          <div
            key={verdict}
            className={`${styles.cell} ${count === 0 ? styles.empty : ""}`}
            data-ui={`tally-cell ${verdict}`}
          >
            <span className={`${styles.mark} ${toneClass(verdict)}`}>
              <VerdictMark verdict={verdict} size={13} />
            </span>
            <span className={styles.count}>{count}</span>
            <span className={styles.label}>{VERDICTS[verdict].label}</span>
          </div>
        );
      })}
    </div>
  );
}
