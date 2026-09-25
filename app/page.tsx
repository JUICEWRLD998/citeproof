import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuditForm } from "@/components/AuditForm";
import { Masthead } from "@/components/Masthead";
import { VERDICTS, VerdictMark, toneClass } from "@/components/verdict";
import { beltConfigFromEnv } from "@/lib/llm";
import { loadCoverageTable } from "@/lib/corpus";
import type { Verdict } from "@/lib/types";
import styles from "./page.module.css";

/**
 * The audit input.
 *
 * A SERVER component, and that is load-bearing rather than incidental: it reads the belt's
 * configuration from `process.env` so the masthead can state whether a model will be consulted. If
 * this file ever became a client component the key would have to reach the browser to answer that
 * question — which is exactly the containment Phase 6 asserts and `tests/selfverify.test.ts` fails
 * the build over.
 */
export const dynamic = "force-dynamic";

/**
 * The sample brief, read from the file the test suite audits. Deliberately the same bytes: a landing
 * page demo built on a *different* document would let the front page drift away from the fixture
 * every verdict was verified against.
 */
function sampleBrief(): string {
  try {
    return readFileSync(join(process.cwd(), "fixtures/briefs/motion-to-dismiss.txt"), "utf8");
  } catch {
    // A build where the fixture is absent still serves an input. The button simply has nothing to
    // fill in, which is a smaller failure than the page refusing to render.
    return "";
  }
}

/** The order the verdicts are explained in: the three that decide, then the three that refuse. */
const LEGEND_ORDER: Verdict[] = [
  "VERIFIED",
  "MISATTRIBUTED",
  "FABRICATED",
  "UNVERIFIABLE_COVERAGE",
  "UNVERIFIABLE_LOW_CONFIDENCE",
  "UNVERIFIABLE_UNRESOLVED",
];

export default function Home() {
  const belt = beltConfigFromEnv();
  const coverage = loadCoverageTable();
  const coverageEnd = Object.values(coverage.reporters)
    .map((r) => r.latestDecisionDate)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <main className={styles.page}>
      <Masthead
        beltMode={belt ? "belt-enabled" : "deterministic-only"}
        coverageEnd={coverageEnd}
      />

      <section className={styles.thesis}>
        <h2>
          It checks every citation and every quotation — and it tells you when it cannot be sure.
        </h2>
        <p>
          Asking one model to verify another fails silently, exactly where it matters. So CiteProof
          does not ask a model whether a citation is real. It fetches the opinion itself, from a
          keyless primary-law corpus, and checks the text against the text.
        </p>
        <p>
          The hard part is not finding fabrications. It is <em>not accusing a correct brief</em>.
          Checked naively, the most famous sentence in American constitutional law reports zero
          occurrences, because the corpus capitalises <span className="mono">Separate</span>. A tool
          that cries wolf on <em>Brown v. Board</em> is worse than no tool at all.
        </p>
      </section>

      <AuditForm sample={sampleBrief()} />

      <section className={styles.legend} aria-label="Verdict vocabulary">
        {LEGEND_ORDER.map((verdict) => {
          const style = VERDICTS[verdict];
          return (
            <div className={styles.legendItem} key={verdict} data-ui={`legend ${verdict}`}>
              <div className={styles.legendHead}>
                <span className={toneClass(verdict)}>
                  <VerdictMark verdict={verdict} size={16} />
                </span>
                <span className={`${styles.legendName} ${toneClass(verdict)}`}>{style.label}</span>
              </div>
              <p className={styles.legendBody}>{style.meaning}</p>
              <p className={styles.legendMark}>
                <span className={styles.legendMarkKey}>marked in the document</span> {style.mark}
              </p>
            </div>
          );
        })}
      </section>

      <section className={styles.rails}>
        <div className={styles.railBlock}>
          <h3>What it will not do</h3>
          <ul>
            <li>
              It will not call a citation fabricated because the case is newer than its corpus. Beyond
              the boundary above, the answer is <em>unverifiable</em>.
            </li>
            <li>
              It will not accuse on OCR-degraded text. Below a measured confidence floor, an absence
              proves nothing either way.
            </li>
            <li>
              It will not treat an empty volume index as evidence. A failed fetch and a nonexistent
              volume look identical from inside the pipeline.
            </li>
            <li>
              No model decides a verdict. The belt proposes a span; the matcher adjudicates it, and{" "}
              <span className="mono">lib/verdict</span> cannot import{" "}
              <span className="mono">lib/llm</span> at all — asserted, not assumed.
            </li>
          </ul>
        </div>
        <div className={styles.railBlock}>
          <h3>What it costs, and where the data comes from</h3>
          <ul>
            <li>
              The corpus is Harvard&apos;s Caselaw Access Project bulk static — free, keyless, and no
              quota. A document with no model consulted costs nothing to audit.
            </li>
            <li>
              CourtListener is used for search only. Its full-text endpoints return 401, and its
              anonymous budget is roughly five requests a minute.
            </li>
            <li>
              When the belt runs, the cost is read from the response rather than computed from a price
              list, and reported per line. An unmeasured cost is reported as absent, never as zero.
            </li>
            <li>
              Nothing is persisted. A brief is privileged, so a report lives in this process and
              nowhere else.
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}
