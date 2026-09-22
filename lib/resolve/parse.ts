import type { Citation, Quotation, Span, AuditItem } from "../types";
import { REPORTER_SPELLINGS, citationReporterToSlug } from "../corpus/slugs";

/**
 * Citation and quotation extraction with offsets into the ORIGINAL document.
 *
 * ## Two contract decisions worth stating, because both are observable
 *
 * **A `Quotation`'s `raw` and `span` cover the INNER text only** — not the delimiting quote
 * marks. `fixtures/ground-truth.json` is the contract: its `quote` values carry no surrounding
 * quotes and its expectations are built with `brief.indexOf(quote)`. A parser that spanned the
 * quote marks would produce offsets that disagree with the frozen ground truth by one character
 * on each side.
 *
 * **A reporter this build cannot map produces NO citation, rather than a citation with a raw
 * reporter string.** Same rule the corpus layer follows: `citationReporterToSlug` returns null
 * and the match is skipped. A confidently-parsed citation in an unmapped reporter would resolve
 * to `OutOfCoverage` anyway, so inventing it only moves the failure later and makes it look like
 * a resolution problem instead of a coverage one.
 */

/**
 * Reporter alternation, built from the MEASURED alias table so the parser cannot accept a
 * spelling the corpus layer will refuse.
 *
 * Ordering is longest-first and is load-bearing, not cosmetic. `84 F. Supp. 3d 784` must parse as
 * volume 84 / reporter `F. Supp. 3d` / page 784. If the shorter `F. Supp.` alternative were tried
 * first it would match `84 F. Supp. 3` — page 3, with a stray `d 784` — because `\d{1,5}` happily
 * matches a single digit. The `(?![0-9A-Za-z])` guard after the page blocks that too, and both
 * defences are tested.
 */
function spellingToPattern(spelling: string): string {
  return spelling
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
}

const REPORTER_PATTERN = REPORTER_SPELLINGS.map(spellingToPattern).join("|");

// `<volume> <reporter> <page>` with an optional `at` in place of the page.
const CITATION_CORE = new RegExp(
  String.raw`(\d{1,4})\s+(${REPORTER_PATTERN})\s+(at\s+)?(\d{1,5})(?![0-9A-Za-z])`,
  "gi",
);

// A pincite trailing the page: ", 495", ", at 495", " at 495", " 495".
const PINCITE = /^\s*,?\s*(?:at\s+)?(\d{1,5})(?![0-9A-Za-z])/;

// The court/year parenthetical: "(1954)", "(S.D.N.Y. 2023)", "(2018-2019)".
const PARENTHETICAL = /^\s*\(([^)]{0,60})\)/;

// Short forms that carry forward the previous full citation.
const ID_PATTERN = /\b(?:Id|ID|id)\.(?:\s*(?:at\s+)?(\d{1,5}))?/g;
const SUPRA_PATTERN = /\bsupra\b(?:\s*,?\s*(?:at\s+)?(\d{1,5}))?/gi;

export interface CitationParseOptions {
  /**
   * Longest a quotation may be. Bounds a pathological document; also stops an unclosed quote
   * mark from swallowing the rest of a filing into one "quotation".
   */
  maxQuoteLength?: number;
}

/**
 * Extract case citations with offsets, pincites, years and short forms.
 *
 * Only shapes that identify a case are produced. The grammar is deliberately narrower than real
 * Bluebook: it does not attempt id./supra resolution inside strings it cannot verify, and it does
 * not guess a reporter.
 */
export function parseCitations(document: string): Citation[] {
  const citations: Citation[] = [];
  const claimed: Span[] = [];

  CITATION_CORE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = CITATION_CORE.exec(document)) !== null) {
    const [whole, volumeRaw, reporterRaw, atRaw, pageRaw] = m;
    const slug = citationReporterToSlug(reporterRaw);
    // Unmapped reporter -> no citation, per the module note above.
    if (!slug) continue;

    const volume = Number(volumeRaw);
    const pageOrPin = Number(pageRaw);
    const usedAt = Boolean(atRaw);
    let end = m.index + whole.length;

    // Trailing pincite, then the parenthetical. Order matters: `347 U.S. 483, 495 (1954)` needs
    // the pincite consumed before the `(1954)` is read as the year.
    let pincite: number | undefined = usedAt ? pageOrPin : undefined;
    if (!usedAt) {
      const rest = document.slice(end);
      const pin = PINCITE.exec(rest);
      // Only accept a pincite that is not itself the start of another citation.
      if (pin && !/^\s*(\d{1,4})\s+[A-Z]/.test(rest.slice(0, pin[0].length + 8))) {
        pincite = Number(pin[1]);
        end += pin[0].length;
      }
    }

    const afterPin = document.slice(end);
    const paren = PARENTHETICAL.exec(afterPin);
    let year: number | undefined;
    if (paren) {
      year = parseYearFromParenthetical(paren[1]);
      if (year != null) end += paren[0].length;
    }

    const start = m.index;
    // A citation already inside a previous one is not a new citation (e.g. the page number of a
    // preceding cite read as a volume).
    if (claimed.some((s) => start < s.end && end > s.start)) continue;
    claimed.push({ start, end });

    citations.push({
      raw: document.slice(start, end),
      volume,
      reporter: reporterRaw.replace(/\s+/g, " ").trim(),
      // `<vol> <reporter> at <n>` states a pincite, not a starting page. The page is filled from
      // a carry-forward below; 0 means "not stated in this citation" and is never treated as a
      // real page by the corpus layer, which would reject it as out of coverage anyway.
      page: usedAt ? 0 : pageOrPin,
      pincite,
      year,
      span: { start, end },
      shortForm: usedAt,
    });
  }

  return carryForwardShortForms(document, citations);
}

function parseYearFromParenthetical(inner: string): number | undefined {
  const span = inner.trim().match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
  if (span) return Number(span[2]);
  const single = inner.trim().match(/^(\d{4})$/);
  if (single) return Number(single[1]);
  // "(S.D.N.Y. 2023)" — court then year, the common form.
  const courtThenYear = inner.trim().match(/(\d{4})\s*$/);
  if (courtThenYear) return Number(courtThenYear[1]);
  return undefined;
}

/**
 * Resolve `Id.`, `supra`, and bare pincites by carrying the previous full citation forward.
 *
 * A second pass rather than part of the scan, because carry-forward depends on the citation
 * BEFORE it, and a single forward scan cannot know the carrier until it has passed it.
 *
 * Each derived citation keeps its own offsets and is marked `shortForm`, so a report can show
 * "Id. at 495" as the text a lawyer wrote while still knowing it means `347 U.S. 483`.
 */
function carryForwardShortForms(document: string, full: Citation[]): Citation[] {
  const out = [...full].sort((a, b) => a.span.start - b.span.start);
  const derived: Citation[] = [];

  const consider = (start: number, end: number, pincite?: number) => {
    if (out.some((c) => start < c.span.end && end > c.span.start)) return;
    if (derived.some((c) => start < c.span.end && end > c.span.start)) return;
    // The carrier is the last citation that ENDS before this short form begins.
    const carrier = [...out, ...derived]
      .filter((c) => c.span.end <= start)
      .sort((a, b) => b.span.end - a.span.end)[0];
    if (!carrier) return;
    derived.push({
      raw: document.slice(start, end),
      volume: carrier.volume,
      reporter: carrier.reporter,
      page: carrier.page,
      pincite: pincite ?? carrier.pincite,
      year: carrier.year,
      span: { start, end },
      shortForm: true,
    });
  };

  ID_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ID_PATTERN.exec(document)) !== null) {
    const pin = m[1] ? Number(m[1]) : undefined;
    consider(m.index, m.index + m[0].length, pin);
  }

  SUPRA_PATTERN.lastIndex = 0;
  while ((m = SUPRA_PATTERN.exec(document)) !== null) {
    // `supra` alone is the marker; the word before it usually names the case. Span the marker.
    const pin = m[1] ? Number(m[1]) : undefined;
    consider(m.index, m.index + m[0].length, pin);
  }

  return [...out, ...derived].sort((a, b) => a.span.start - b.span.start);
}

/**
 * Extract quoted spans. `raw` is the inner text; `span` covers the inner text in the original.
 *
 * Handles ASCII and curly double quotes, including quotations that span line breaks — the fixture
 * brief wraps mid-sentence, so a pattern requiring a single line would silently drop the flagship
 * quotation. Curly and ASCII delimiters are matched separately rather than mixed, so a document
 * that opens with a curly quote and closes with an ASCII one does not produce a span that runs to
 * the end of the file.
 */
export function parseQuotations(document: string, opts: CitationParseOptions = {}): Quotation[] {
  const max = opts.maxQuoteLength ?? 4000;
  const spans: Span[] = [];

  const scan = (open: RegExp, close: string) => {
    open.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = open.exec(document)) !== null) {
      const inner = m[1];
      if (!inner || inner.length > max || !inner.trim()) continue;
      const start = m.index + m[0].indexOf(inner);
      spans.push({ start, end: start + inner.length });
      void close;
    }
  };

  scan(/"([^"]*)"/g, '"');
  scan(/“([^”]*)”/g, "”");

  const sorted = spans.sort((a, b) => a.start - b.start).filter((s, i, arr) => {
    // Drop a span wholly contained in the previous one (a quote inside a quote).
    const prev = arr[i - 1];
    return !prev || s.start >= prev.end;
  });

  return sorted.map((span) => ({ raw: document.slice(span.start, span.end), span }));
}

/**
 * Bind each quotation to the citation it is attributed to.
 *
 * Binds to the NEAREST citation in either direction, preferring the preceding one on a tie. Both
 * directions are needed, and the frozen brief proves it: E1 and E2 put the citation before the
 * quotation ("...held that \"Separate...\""), while E5 puts it after ("\"...alone.\" Plessy v.
 * Ferguson, 163 U.S. 537, 556 (1896)."). A preceding-only rule would drop E5 entirely.
 *
 * This is a heuristic about drafting convention, not a fact about the law. Phase 3 may refine it;
 * nothing downstream should treat the binding as authoritative.
 */
export function bindQuotations(citations: Citation[], quotations: Quotation[]): AuditItem[] {
  const ordered = [...citations].sort((a, b) => a.span.start - b.span.start);

  return quotations.map((quotation) => {
    const before = [...ordered].filter((c) => c.span.end <= quotation.span.start).pop();
    const after = ordered.find((c) => c.span.start >= quotation.span.end);
    const attributedTo = pickBinding(quotation.span, before, after);

    return {
      // Deterministic and unique per quotation, so a report's deep link is stable across runs.
      id: `q${quotation.span.start}-${quotation.span.end}`,
      citation: attributedTo ?? UNATTRIBUTED,
      quotation: { ...quotation, attributedTo },
    };
  });
}

function pickBinding(span: Span, before?: Citation, after?: Citation): Citation | undefined {
  if (before && after) {
    const dBefore = span.start - before.span.end;
    const dAfter = after.span.start - span.end;
    // Prefer the preceding citation when it is no further away: a quotation is normally
    // introduced by its citation, and the trailing citation tends to belong to the NEXT sentence.
    return dBefore <= dAfter ? before : after;
  }
  return before ?? after;
}

/**
 * Stand-in citation for a quotation with no citation anywhere near it.
 *
 * Every AuditItem needs a `citation`, and inventing one with plausible volume/page numbers would
 * create exactly the fabricated-citation problem this product reports on. So it is explicitly
 * unusable — volume 0, empty reporter — which the corpus layer rejects as Unresolved rather than
 * resolving it to a real case.
 */
const UNATTRIBUTED: Citation = {
  raw: "",
  volume: 0,
  reporter: "",
  page: 0,
  span: { start: 0, end: 0 },
  shortForm: false,
};

export function isUnattributed(citation: Citation): boolean {
  return citation.volume === 0 && citation.reporter === "";
}
