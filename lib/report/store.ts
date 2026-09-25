import { createHash } from "node:crypto";
import type { ReportBundle } from "./bundle";

/**
 * Where a finished report lives between the POST that produced it and the GET that renders it.
 *
 * ## Why this is a Map and not a database
 *
 * The product's core promise is a keyless, zero-cost audit that anyone can re-run. Persisting
 * reports would mean a datastore, a retention policy, and a place for a privileged document to
 * leak — and a brief under audit is privileged. So a report lives in the server process's memory
 * and nowhere else: it is not written to disk, not logged, and it disappears when the process does.
 *
 * ## What that costs, stated plainly
 *
 *  - A restart loses every report. The demo path re-audits the fixture brief in seconds, so this is
 *    cheap for the demo and honest for a deployment (see `docs/LIMITS.md` §15).
 *  - Reports are per-process, so a multi-instance deployment would need sticky routing or a real
 *    store. Neither is in this build.
 *  - The map is bounded: the oldest entry is evicted past `MAX_REPORTS`, so an unauthenticated
 *    endpoint cannot grow the process without limit.
 *
 * The id is a hash of the audited document, so re-auditing the same brief returns the same id — a
 * deep link stays valid across a re-run and the demo can be replayed against a fixed URL.
 */

export const MAX_REPORTS = 24;

/**
 * Pinned on `globalThis` so Next's dev server re-evaluating this module does not silently hand the
 * report page a fresh, empty store — which would present as "that report does not exist" for a
 * report the user just created, and read as a bug in the audit rather than in the plumbing.
 */
const store: Map<string, ReportBundle> = ((
  globalThis as unknown as { __citeproofReports?: Map<string, ReportBundle> }
).__citeproofReports ??= new Map<string, ReportBundle>());

/** sha256 of the document, first 12 hex characters. Stable for identical bytes, cheap to read. */
export function reportId(document: string): string {
  return createHash("sha256").update(document, "utf8").digest("hex").slice(0, 12);
}

export function putReport(bundle: ReportBundle): void {
  // Re-inserting moves the key to the end, so eviction is by last write rather than first.
  store.delete(bundle.id);
  store.set(bundle.id, bundle);
  while (store.size > MAX_REPORTS) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

export function getReport(id: string): ReportBundle | null {
  // A Map, deliberately, rather than an object keyed by id: report ids arrive from the URL, and
  // `__proto__` / `constructor` as keys on a plain object would reach the prototype instead of the
  // store. Map keys are values, so a hostile id is just a miss.
  return store.get(id) ?? null;
}

/** How many reports this process is holding. Used by the receipts, not by the UI. */
export function reportCount(): number {
  return store.size;
}
