import Link from "next/link";
import styles from "./Masthead.module.css";

/**
 * The masthead: a wordmark, what the tool is, and the two facts that decide how to read everything
 * below it — whether the belt is running, and where the corpus stops.
 *
 * Both facts are stated on the surface rather than in a footer, because they are the two ways this
 * tool can be misread: a reader who does not know the belt is off might think no proposition was
 * supported, and a reader who does not know the corpus ends in 2019 might read a refusal as a
 * finding. Putting them at the top is the cheapest honesty available.
 */
export function Masthead({
  beltMode,
  coverageEnd,
  action,
}: {
  beltMode: "belt-enabled" | "deterministic-only";
  /** Latest decision date the corpus can serve, ISO. Shown as the boundary, not as a number to admire. */
  coverageEnd?: string;
  /** The one accent moment on the page, when there is one. */
  action?: React.ReactNode;
}) {
  return (
    <header className={styles.masthead} data-ui="masthead">
      <div className={styles.identity}>
        <Link href="/" className={styles.wordmark} data-ui="wordmark">
          CiteProof
        </Link>
        <p className={styles.tagline}>
          Citation and quotation audit against primary law
        </p>
      </div>

      <div className={styles.facts} data-ui="masthead-facts">
        <span className={styles.fact} data-ui={`belt-status ${beltMode}`}>
          <span className={styles.factLabel}>belt</span>
          <span className={styles.factValue}>
            {beltMode === "belt-enabled" ? "on · proposer only" : "off · no key"}
          </span>
        </span>
        {coverageEnd ? (
          <span className={styles.fact} data-ui="coverage-status">
            <span className={styles.factLabel}>corpus to</span>
            <span className={styles.factValue}>{coverageEnd}</span>
          </span>
        ) : null}
        {action ? <span className={styles.action}>{action}</span> : null}
      </div>
    </header>
  );
}
