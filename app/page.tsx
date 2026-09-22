import styles from "./page.module.css";

/**
 * The four verdict marks, drawn rather than iconised.
 * Colour is NEVER the sole signal (WCAG 1.4.1): each mark is a distinct SHAPE and every
 * rail also carries a text label, so a verdict survives greyscale and any form of
 * colour-vision deficiency. The palette reinforces; the form carries.
 */
function Mark({ verdict, size = 15 }: { verdict: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    "aria-hidden": true,
    focusable: false as const,
  };
  const stroke = 1.5;

  if (verdict === "VERIFIED") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth={stroke} />
        <path d="M5.1 8.3l2 2 3.8-4.2" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (verdict === "MISATTRIBUTED") {
    // an arrow leaving the frame: the sentence is real, but it lives elsewhere
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth={stroke} />
        <path d="M5.4 10.6l5.2-5.2" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
        <path d="M7.6 5.4h3v3" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (verdict === "FABRICATED") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth={stroke} />
        <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
      </svg>
    );
  }
  // UNVERIFIABLE: dashed frame, a dash where a judgement would be. No fill, no hue.
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth={stroke} strokeDasharray="2.2 2.2" />
      <path d="M5.4 8h5.2" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
    </svg>
  );
}

const LEGEND = [
  {
    verdict: "VERIFIED",
    cls: styles.vVerified,
    body: "The citation resolves to a real case and the quotation is found verbatim in it, with character offsets a third party can re-run.",
  },
  {
    verdict: "MISATTRIBUTED",
    cls: styles.vMisattributed,
    body: "The sentence is real, but it is not in the case you cited. We name where it actually lives. No competitor ships this.",
  },
  {
    verdict: "FABRICATED",
    cls: styles.vFabricated,
    body: "The citation resolves to no case, and the corpus that would contain it was readable. Reported with the full resolution log.",
  },
  {
    verdict: "UNVERIFIABLE",
    cls: styles.vUnverifiable,
    body: "We cannot say. The case is past our corpus boundary, the record is too OCR-damaged, or the citation did not resolve. Never reported as fabricated.",
  },
];

/** Preview lines, taken verbatim from the verified fixtures in fixtures/ground-truth.json. */
const LINES = [
  {
    cite: "347 U.S. 483",
    verdict: "VERIFIED",
    cls: styles.vVerified,
    label: "verified",
    body: (
      <>
        In <em>Brown v. Board of Education</em>, 347 U.S. 483, 495 (1954), the Court held
        that &ldquo;<span className={styles.quoteFound}>Separate educational facilities are inherently unequal.</span>&rdquo;
      </>
    ),
    note: null,
  },
  {
    cite: "163 U.S. 537",
    verdict: "MISATTRIBUTED",
    cls: styles.vMisattributed,
    label: "misattributed",
    body: (
      <>
        It was first announced in <em>Plessy v. Ferguson</em>, 163 U.S. 537, 544 (1896),
        where the Court held that &ldquo;<span className={styles.quoteFound}>Separate educational facilities are inherently unequal.</span>&rdquo;
      </>
    ),
    note: "That sentence is in 347 U.S. 483, char 9564 — not in Plessy. Plessy's own OCR confidence is 0.434.",
  },
  {
    cite: "999 U.S. 1234",
    verdict: "FABRICATED",
    cls: styles.vFabricated,
    label: "fabricated",
    body: (
      <>
        See <em>Anderson v. Liberty Lobby, Inc.</em>, 999 U.S. 1234, 1240 (2021) (holding
        that &ldquo;<span className={styles.struck}>summary judgment is warranted only where the evidence is such that no reasonable jury could return a verdict for the nonmoving party</span>&rdquo;).
      </>
    ),
    note: "Reporter volume 999 does not exist — the U.S. Reports corpus ends at volume 572.",
  },
  {
    cite: "678 F. Supp. 3d 443",
    verdict: "UNVERIFIABLE",
    cls: styles.vUnverifiable,
    label: "unverifiable",
    body: (
      <>
        Nor can Plaintiff rely on <em>Mata v. Avianca, Inc.</em>, 678 F. Supp. 3d 443, 452
        (S.D.N.Y. 2023), which the Complaint cites for a duty of candor to the tribunal.
      </>
    ),
    note: "f-supp-3d coverage ends 2019-08-19. This case is real and post-dates it — so we refuse to call it invented.",
  },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <h1 className={styles.wordmark}>CiteProof</h1>
        <p className={styles.tagline}>
          Citation and quotation audit for AI-drafted briefs — against primary law.
        </p>
        <span className={styles.spacer} />
        <span className={styles.badge}>design preview · engine in build</span>
      </header>

      <section className={styles.thesis}>
        <h2>
          It checks every citation and every quotation — and it tells you when it cannot
          be sure.
        </h2>
        <p>
          Asking one model to verify another fails silently, exactly where it matters. So
          CiteProof does not ask a model. It fetches the opinion itself, from a keyless
          primary-law corpus, and checks the text against the text.
        </p>
        <p>
          The hard part is not finding fabrications. It is <em>not accusing a correct
          brief</em>. Checked naively, the most famous sentence in American constitutional
          law reports zero occurrences, because the corpus capitalises{" "}
          <span className="mono">Separate</span>. A tool that cries wolf on{" "}
          <em>Brown v. Board</em> is worse than no tool at all.
        </p>
      </section>

      <section className={styles.legend} aria-label="Verdict vocabulary">
        {LEGEND.map((l) => (
          <div key={l.verdict} className={styles.legendItem}>
            <div className={styles.legendHead}>
              <span className={l.cls}>
                <Mark verdict={l.verdict} size={16} />
              </span>
              <span className={`${styles.legendName} ${l.cls}`}>{l.verdict}</span>
            </div>
            <p className={styles.legendBody}>{l.body}</p>
          </div>
        ))}
      </section>

      <p className={styles.sectionLabel}>
        The annotated brief — four real fixture lines, verified against the corpus
      </p>

      <article className={styles.brief}>
        {LINES.map((l) => (
          <div key={l.cite + l.verdict} className={styles.auditedLine}>
            <div className={styles.rail}>
              <span className={styles.railCite}>{l.cite}</span>
              <span className={`${styles.railMark} ${l.cls}`}>
                <Mark verdict={l.verdict} />
                <span className={styles.railLabel}>{l.label}</span>
              </span>
            </div>
            <div className={styles.lineBody}>
              {l.body}
              {l.note && (
                <>
                  {l.verdict === "UNVERIFIABLE" && <hr className={styles.unverifiableRule} />}
                  <p
                    style={{
                      margin: "7px 0 0",
                      fontSize: "12.5px",
                      lineHeight: 1.55,
                      color: "var(--muted)",
                    }}
                  >
                    {l.note}
                  </p>
                </>
              )}
            </div>
          </div>
        ))}
      </article>

      <section className={styles.status}>
        <div className={styles.statusBlock}>
          <h3>Verified against primary source</h3>
          <ul>
            <li>Harvard CAP bulk static serves verbatim opinion text with no key and no quota</li>
            <li><span className="mono">us/347/cases/0483-01.json</span> — 26,823 chars, OCR 0.664</li>
            <li><span className="mono">us/163/cases/0537-01.json</span> — OCR 0.434, two opinions</li>
            <li>CourtListener full-text endpoints are 401; search only, ~5 req/min</li>
            <li>22 failing tests already encode these four verdicts</li>
          </ul>
        </div>
        <div className={styles.statusBlock}>
          <h3>Still to build</h3>
          <ul>
            <li><span className={styles.pending}>Phase 1</span> — corpus layer, sha256 cache, coverage boundary</li>
            <li><span className={styles.pending}>Phase 2–3</span> — citation parser, normalisation, resolution cascade</li>
            <li><span className={styles.pending}>Phase 4–5</span> — quote matcher, verdicts, misattribution resolver</li>
            <li><span className={styles.pending}>Phase 6</span> — OpenRouter proposal belt, self-verified</li>
            <li><span className={styles.pending}>Phase 7</span> — this preview wired to the live engine</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
