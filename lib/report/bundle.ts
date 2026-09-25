import type {
  AuditItem,
  AuditResult,
  Citation,
  Quotation,
  ResolutionStep,
  ResolvedCase,
  Span,
  Verdict,
} from "@/lib/types";
import type { VerificationStatus } from "@/lib/llm";
import { caseSourceLink, type SourceLink } from "./sources";

/**
 * The report's own contract.
 *
 * The engine's types (`AuditResult`, `ResolvedCase`) carry the WHOLE opinion text — 26,823
 * characters of it — because the matcher needs it. The report does not: it needs the offsets, the
 * evidence around them, and a link to the bytes. So this layer reshapes engine output into
 * something a page can render and a test can check, and it never invents a field the engine did not
 * produce. Where a number could not be measured it is `null`, and the UI says so.
 */

/** A window of the opinion's own text around the span a verdict was decided on. */
export interface Excerpt {
  /** Already whitespace-collapsed for display; the offsets below refer to the RAW text. */
  before: string;
  match: string;
  after: string;
  /** True when the window was cut, so the reader knows there is more text either side. */
  truncatedBefore: boolean;
  truncatedAfter: boolean;
}

export interface ReportCase {
  citation: string;
  caseName: string;
  caseNameFull: string;
  decisionDate: string;
  court: string;
  allCitations: string[];
  ocrConfidence: number;
  opinionBodyMissing: boolean;
  /** How many characters of opinion text we searched. Absent means we never got any. */
  characters: number;
  source: SourceLink;
}

export interface ReportBelt {
  status: VerificationStatus;
  /** The model's own claim, kept verbatim so a reader can see what it said. */
  proposedSpan: string | null;
  /** The opinion's OWN bytes at the span the matcher located, never the model's rendering. */
  verbatim: string | null;
  span: Span | null;
  selfReportedConfidence: number | null;
  sharedRunWords: number | null;
  sharedRunText: string | null;
  reason: string;
  provider: string | null;
  model: string | null;
  seed: number | null;
  promptVersion: string;
  generationId: string | null;
  costUsd: number | null;
  latencyMs: number | null;
}

export interface ReportItem {
  id: string;
  verdict: Verdict;
  reason: string;
  citation: Citation;
  quotation: Quotation;
  /** Where the quotation sits in the user's document. Always present: the parser measured it. */
  documentSpan: Span;
  /** Where it was found in an opinion. Absent for every verdict that found nothing. */
  opinionSpan: Span | null;
  /** Which case `opinionSpan` indexes into. `cited` unless the verdict is MISATTRIBUTED. */
  excerptSide: "cited" | "trueHome" | null;
  excerpt: Excerpt | null;
  citedCase: ReportCase | null;
  trueHome: ReportCase | null;
  /** Ranked, best-first, when a new home was found. The quoters that lost are shown, not hidden. */
  trueHomeCandidates: ReportCase[];
  trace: ResolutionStep[];
  belt: ReportBelt | null;
}

export type VerdictCounts = Record<Verdict, number>;

export interface ReportSummary {
  total: number;
  counts: VerdictCounts;
  /** Verdicts that make a positive claim about the text. */
  positive: number;
  /** The one verdict that accuses. */
  accusations: number;
  /** Verdicts that refuse to say. The number the honesty layer exists to be able to report. */
  refusals: number;
  belt: {
    ran: boolean;
    supported: number;
    unsupported: number;
    declined: number;
    unavailable: number;
    costUsd: number | null;
  };
}

export interface ReportMeta {
  auditedAt: string;
  /** Requests the corpus layer actually issued while producing this report. */
  networkCalls: number;
  /** Which corpus the verdicts were decided against, so a stale report cannot mislead. */
  corpus: string;
  /** Reporter -> last decision date we can serve. The boundary, on the page, not in a footer. */
  coverage: { reporter: string; latestDecisionDate: string }[];
}

export interface ReportBundle {
  id: string;
  /** The document exactly as audited. Every offset in the report indexes into THIS string. */
  document: string;
  title: string;
  summary: ReportSummary;
  items: ReportItem[];
  rows: DocRow[];
  meta: ReportMeta;
}

// --- the annotated document ---------------------------------------------------

/**
 * A slice of the audited document, tagged with what the tool knows about it.
 *
 * Segments tile the document in order and never overlap, so `rows` can be rendered as the original
 * text with only two kinds of mark inside it: a citation and a quotation. That is what makes the
 * report read as an annotated brief rather than as a list of findings beside an unrelated document.
 */
export type DocSegment =
  | { kind: "text"; text: string; start: number; end: number }
  | { kind: "citation"; text: string; start: number; end: number; itemId: string }
  | { kind: "quotation"; text: string; start: number; end: number; itemId: string };

export interface DocRow {
  start: number;
  end: number;
  segments: DocSegment[];
  /** Rail entries aligned to this row, in document order. Empty for an unannotated paragraph. */
  itemIds: string[];
}

/**
 * Build the annotated document.
 *
 * Two decisions worth stating, because both could reasonably have gone the other way:
 *
 * 1. **A quotation inside a quotation's range is not emitted separately.** When a citation sits
 *    INSIDE a quoted sentence, marking both would mean nesting marks, and the inner one would be
 *    unreadable at 15px. The quotation wins — it is the larger, more specific claim — and the item
 *    still appears in the rail with its citation in mono. Measured on the fixture brief: no such
 *    overlap occurs; this is here so that a document which does produce one degrades to a readable
 *    mark rather than to broken markup.
 * 2. **Rows are the document's own paragraphs**, split on blank lines. Not sentences, not fixed
 *    height. The rail is a margin, and a margin belongs to a paragraph.
 */
export function buildDocumentRows(document: string, items: readonly AuditItem[]): DocRow[] {
  const spans: { start: number; end: number; itemId: string; kind: "citation" | "quotation" }[] = [];

  for (const item of items) {
    const q = item.quotation.span;
    if (q.end > q.start && q.start >= 0 && q.end <= document.length) {
      spans.push({ start: q.start, end: q.end, itemId: item.id, kind: "quotation" });
    }
    const c = item.citation.span;
    // A short-form citation ("Id. at 495") is a legitimate citation span and gets a mark too: the
    // reader needs to see WHICH text carried the reference, since that is the line being judged.
    if (c.end > c.start && c.start >= 0 && c.end <= document.length) {
      spans.push({ start: c.start, end: c.end, itemId: item.id, kind: "citation" });
    }
  }

  // Quotations first, then citations; longer spans win an overlap, and precedence is decided by
  // sorting rather than by trust in input order.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const accepted: typeof spans = [];
  for (const span of spans) {
    const clash = accepted.find((a) => span.start < a.end && a.start < span.end);
    if (clash) continue;
    accepted.push(span);
  }

  const rows: DocRow[] = [];
  const paragraphs = paragraphRanges(document);

  for (const para of paragraphs) {
    const segs: DocSegment[] = [];
    let cursor = para.start;
    const inRow: string[] = [];

    for (const span of accepted) {
      if (span.start < para.start || span.end > para.end) continue;
      if (span.start > cursor) {
        segs.push({ kind: "text", text: document.slice(cursor, span.start), start: cursor, end: span.start });
      }
      segs.push({
        kind: span.kind,
        text: document.slice(span.start, span.end),
        start: span.start,
        end: span.end,
        itemId: span.itemId,
      });
      cursor = span.end;
      if (!inRow.includes(span.itemId)) inRow.push(span.itemId);
    }

    if (cursor < para.end) {
      segs.push({ kind: "text", text: document.slice(cursor, para.end), start: cursor, end: para.end });
    }

    rows.push({ start: para.start, end: para.end, segments: segs, itemIds: inRow });
  }

  return rows;
}

/** Ranges of non-blank lines, newline excluded. Blank runs collapse into a normalised gap. */
function paragraphRanges(document: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const lines = document.split("\n");
  let offset = 0;
  let runStart = -1;
  let runEnd = -1;

  const flush = () => {
    if (runStart >= 0) out.push({ start: runStart, end: runEnd });
    runStart = -1;
    runEnd = -1;
  };

  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1; // + the newline
    if (line.trim()) {
      if (runStart < 0) runStart = lineStart;
      runEnd = lineEnd;
    } else {
      flush();
    }
  }
  flush();
  return out;
}

/**
 * The proposition the belt is asked about: the document's own sentence carrying the quotation.
 *
 * Deliberately taken from the DRAFTER's text, not composed by us. Asking the model whether a
 * sentence of our own construction is supported would make the belt's answer a statement about our
 * paraphrase; asking about the drafter's sentence keeps it a statement about the brief on the page.
 *
 * A legal brief is HARD-WRAPPED, so a newline is not a sentence boundary — the first version of this
 * function treated it as one and cut the proposition off mid-citation, producing
 * `537, 544 (1896), where the Court held …` for a line that begins `163 U.S.\n537`. That is the same
 * whitespace trap `implementation.md` §4 row 15 records against the ground-truth fixture: measure
 * against the document's real bytes, never against its line breaks. Boundaries are therefore
 * sentence-ending punctuation only, with an abbreviation guard, because legal prose is full of
 * `Brown v. Board`, `347 U.S. 483` and `7th Cir. 2011`.
 */
export function propositionFor(document: string, span: Span): string {
  const start = lastBoundary(document, span.start);
  const end = firstBoundary(document, span.end);
  const sentence = collapse(document.slice(start, end)).trim();

  if (sentence.length && sentence.length <= MAX_PROPOSITION_CHARS) return sentence;

  // No terminator nearby, or a sentence longer than the cap (a run-on paragraph, or a document with
  // no punctuation at all). Fall back to a bounded window around the claim rather than sending a
  // whole page to the model, and say so in nothing but the prompt — the belt is asked about claim
  // support, and a window is a coarser question than a sentence. Better coarser than unbounded.
  const from = Math.max(0, span.start - PROPOSITION_WINDOW);
  const to = Math.min(document.length, span.end + PROPOSITION_WINDOW);
  return collapse(document.slice(from, to)).trim();
}

/** Upper bound on the proposition handed to the model. */
export const MAX_PROPOSITION_CHARS = 900;
const PROPOSITION_WINDOW = 400;

/** Tokens whose trailing period does NOT end a sentence, in the register this corpus is written in. */
const ABBREVIATIONS = new Set([
  "v", "vs", "u.s", "u.s.c", "f", "f.2d", "f.3d", "f.supp", "f.supp.2d", "f.supp.3d",
  "s.ct", "l.ed", "l.ed.2d", "cir", "inc", "no", "nos", "mr", "mrs", "ms", "dr", "cf",
  "e.g", "i.e", "id", "seq", "supp", "stat", "art", "sec", "ch", "ex", "rel", "ct",
]);

/** True when the terminator at `i` ends a sentence rather than an abbreviation or a citation run. */
function endsSentence(text: string, i: number): boolean {
  let j = i + 1;
  // Closing quotes and brackets belong to the sentence they end. Without this, the fixture brief's
  // `…are inherently unequal."` reads as NOT a sentence end, because the next character is a quote —
  // measured, and it silently swallowed the whole following paragraph into the proposition.
  while (j < text.length && /["'”’)\]}*]/.test(text[j])) j++;
  if (j < text.length && !/\s/.test(text[j])) return false; // "U.S." inside a citation
  while (j < text.length && /\s/.test(text[j])) j++;
  if (j >= text.length) return true;
  // The next sentence starts with a capital, a digit, or an opening quote. Anything else
  // ("…here. and then") is a typo, not a boundary, and guessing there would cut a sentence short.
  if (!/[A-Z0-9"“]/.test(text[j])) return false;
  const token = /([A-Za-z.]+)$/.exec(text.slice(Math.max(0, i - 14), i + 1));
  if (token) {
    const word = token[1].replace(/^\.+/, "").replace(/\.+$/, "").toLowerCase();
    if (ABBREVIATIONS.has(word)) return false;
    if (word.length === 1) return false; // a single initial, or "v."
  }
  return true;
}

function lastBoundary(text: string, from: number): number {
  for (let i = from - 1; i >= 0; i--) {
    const ch = text[i];
    if ((ch === "." || ch === "!" || ch === "?") && endsSentence(text, i)) return i + 1;
    // A blank line IS a boundary: paragraphs are the document's own structure.
    if (ch === "\n" && text[i - 1] === "\n") return i + 1;
  }
  return 0;
}

function firstBoundary(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if ((ch === "." || ch === "!" || ch === "?") && endsSentence(text, i)) return i + 1;
    if (ch === "\n" && text[i + 1] === "\n") return i;
  }
  return text.length;
}

// --- assembling the report ----------------------------------------------------

export interface BuildReportInput {
  id: string;
  document: string;
  title: string;
  items: readonly AuditItem[];
  results: readonly AuditResult[];
  belt: readonly ReportBelt[] | null;
  meta: ReportMeta;
}

export function buildReport(input: BuildReportInput): ReportBundle {
  const byId = new Map(input.results.map((r) => [r.itemId, r]));
  const items: ReportItem[] = input.items.map((item, i) => {
    const result = byId.get(item.id);
    if (!result) {
      // Unreachable in practice: `auditDocument` returns one result per item. Thrown rather than
      // defaulted, because a report that silently omits a line is a report that lies by omission.
      throw new Error(`no audit result for item ${item.id}`);
    }
    return toReportItem(item, result, input.belt?.[i] ?? null);
  });

  return {
    id: input.id,
    document: input.document,
    title: input.title,
    items,
    rows: buildDocumentRows(input.document, input.items),
    summary: summarise(input.results, input.belt),
    meta: input.meta,
  };
}

function toReportItem(item: AuditItem, result: AuditResult, belt: ReportBelt | null): ReportItem {
  // The offset the reader is deep-linked to. `foundInOpinion` already resolves to the true home for
  // MISATTRIBUTED (see lib/verdict/index.ts), so the excerpt side follows the same rule here.
  const opinionSpan = result.foundInOpinion ?? null;
  const side: ReportItem["excerptSide"] =
    opinionSpan == null ? null : result.verdict === "MISATTRIBUTED" ? "trueHome" : "cited";
  const excerptCase = side === "trueHome" ? result.trueHome : result.citedCase;

  return {
    id: item.id,
    verdict: result.verdict,
    reason: result.reason,
    citation: item.citation,
    quotation: item.quotation,
    documentSpan: item.quotation.span,
    opinionSpan,
    excerptSide: side,
    excerpt: opinionSpan && excerptCase ? buildExcerpt(excerptCase.text, opinionSpan) : null,
    citedCase: result.citedCase ? toReportCase(result.citedCase) : null,
    trueHome: result.trueHome ? toReportCase(result.trueHome) : null,
    trueHomeCandidates: (result.trueHomeCandidates ?? []).map(toReportCase),
    trace: result.resolutionTrace ?? [],
    belt,
  };
}

export function toReportCase(c: ResolvedCase): ReportCase {
  return {
    citation: c.citation,
    caseName: c.caseName,
    caseNameFull: c.caseNameFull,
    decisionDate: c.decisionDate,
    court: c.court,
    allCitations: c.allCitations,
    ocrConfidence: c.ocrConfidence,
    opinionBodyMissing: c.opinionBodyMissing,
    characters: c.text?.length ?? 0,
    source: caseSourceLink(c.caseName, [c.citation, ...c.allCitations]),
  };
}

/** How much opinion text to show either side of the span. Wide enough to read as a passage. */
export const EXCERPT_PADDING = 260;

function buildExcerpt(text: string, span: Span): Excerpt | null {
  if (!text) return null;
  const start = Math.max(0, span.start - EXCERPT_PADDING);
  const end = Math.min(text.length, span.end + EXCERPT_PADDING);
  // Whitespace is collapsed for DISPLAY only. The offsets printed beside the excerpt are the raw
  // ones, and `characters` is the raw length, so a reader can still re-derive the byte position.
  return {
    before: collapse(text.slice(start, span.start)),
    match: collapse(text.slice(span.start, span.end)),
    after: collapse(text.slice(span.end, end)),
    truncatedBefore: start > 0,
    truncatedAfter: end < text.length,
  };
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ");
}

const ALL_VERDICTS: Verdict[] = [
  "VERIFIED",
  "MISATTRIBUTED",
  "FABRICATED",
  "UNVERIFIABLE_COVERAGE",
  "UNVERIFIABLE_LOW_CONFIDENCE",
  "UNVERIFIABLE_UNRESOLVED",
];

export function emptyCounts(): VerdictCounts {
  return Object.fromEntries(ALL_VERDICTS.map((v) => [v, 0])) as VerdictCounts;
}

export function summarise(
  results: readonly AuditResult[],
  belt: readonly ReportBelt[] | null,
): ReportSummary {
  const counts = emptyCounts();
  for (const r of results) counts[r.verdict] += 1;

  const beltSummary = { ran: false, supported: 0, unsupported: 0, declined: 0, unavailable: 0, costUsd: null as number | null };
  if (belt) {
    let cost = 0;
    let sawCost = false;
    for (const b of belt) {
      if (b.status !== "unavailable") beltSummary.ran = true;
      beltSummary[b.status] += 1;
      if (typeof b.costUsd === "number") {
        sawCost = true;
        cost += b.costUsd;
      }
    }
    // Null, not 0, when nothing reported a cost: a run with no key must not look like a run that
    // cost nothing, and a response that omitted cost must not be priced at a guess.
    beltSummary.costUsd = sawCost ? Number(cost.toFixed(6)) : null;
  }

  return {
    total: results.length,
    counts,
    positive: counts.VERIFIED + counts.MISATTRIBUTED,
    accusations: counts.FABRICATED,
    refusals:
      counts.UNVERIFIABLE_COVERAGE +
      counts.UNVERIFIABLE_LOW_CONFIDENCE +
      counts.UNVERIFIABLE_UNRESOLVED,
    belt: beltSummary,
  };
}
