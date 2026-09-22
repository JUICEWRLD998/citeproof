import type { AuditItem, AuditResult } from "./types";
import { bindQuotations, parseCitations, parseQuotations } from "./resolve";
import { auditItem } from "./verdict";

export interface AuditOptions {
  /** Include resolution traces. The demo turns this on; batch runs leave it off. */
  verbose?: boolean;
  /** Cap on items, so a pathological document cannot burn the corpus budget. */
  maxItems?: number;
}

/**
 * Full pipeline: document -> citation/quote extraction -> resolution -> verdicts.
 *
 * Phase 7 wires this to `app/api/audit/route.ts`. Every stage is independently
 * testable; this function only sequences them.
 */
export async function auditDocument(
  document: string,
  opts: AuditOptions = {},
): Promise<AuditResult[]> {
  const citations = parseCitations(document);
  const quotations = parseQuotations(document);
  const items: AuditItem[] = bindQuotations(citations, quotations);
  const capped = opts.maxItems ? items.slice(0, opts.maxItems) : items;
  return Promise.all(capped.map((item) => auditItem(item)));
}
