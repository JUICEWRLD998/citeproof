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
 *
 * The wordmark is the page's `h1`. Measured: on the landing page it rendered as a plain link inside
 * the `<header>`, so the document had NO top-level heading at all — the first heading on the page was
 * an `h2`, which is a real outline defect for a screen reader and a crawler alike. It stays a link
 * back to `/`; on the report page that is the way home.
 */
export function Masthead({
  beltMode,
  coverageEnd,
  action,
  headingLevel = "h1",
}: {
  beltMode: "belt-enabled" | "deterministic-only";
  /** Latest decision date the corpus can serve, ISO. Shown as the boundary, not as a number to admire. */
  coverageEnd?: string;
  /** The one accent moment on the page, when there is one. */
  action?: React.ReactNode;
  /** The landing page has no other title, so the wordmark is its `h1`. */
  headingLevel?: "h1" | "div";
}) {
  const Wordmark = headingLevel;
  return (
    <header className={styles.masthead} data-ui="masthead">
      <div className={styles.identity}>
        {/*
          The heading IS the wordmark's box, with the link inside it — the standard accessible
          wordmark pattern. An earlier version wrapped a styled link in a separate heading element
          that reset its own typography to `inherit`, so the `h1` computed a font-weight of 400 while
          the link inside it rendered 750. The page looked right and its outline was wrong, which is
          exactly the class of defect a screenshot cannot show.
        */}
        <Wordmark className={styles.wordmark}>
          <Link href="/" className={styles.wordmarkLink} data-ui="wordmark">
            CiteProof
          </Link>
        </Wordmark>
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
