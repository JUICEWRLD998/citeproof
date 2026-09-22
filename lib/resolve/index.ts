import type { AuditItem, Citation, Quotation } from "../types";

function notImplemented(what: string): never {
  throw new Error(`${what} is not implemented yet — see implementation.md Phase 2-3.`);
}

/** Extract case citations with offsets. Handles pincites and reporter variants. */
export function parseCitations(_document: string): Citation[] {
  return notImplemented("parseCitations");
}

/** Extract quoted spans with offsets. */
export function parseQuotations(_document: string): Quotation[] {
  return notImplemented("parseQuotations");
}

/**
 * Bind each quotation to the citation it is attributed to.
 * Handles short forms (Id., supra, "at 495") by carrying forward the last full citation.
 */
export function bindQuotations(_citations: Citation[], _quotations: Quotation[]): AuditItem[] {
  return notImplemented("bindQuotations");
}
