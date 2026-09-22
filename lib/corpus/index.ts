import type { ResolvedCase, CorpusError } from "../types";

/**
 * Thrown by every corpus function instead of returning null. Callers must branch on
 * `kind`: an unresolved citation and an out-of-coverage citation are DIFFERENT verdicts,
 * and collapsing them into one null is how a tool ends up accusing modern cases.
 */
export class CorpusFailure extends Error {
  readonly detail: CorpusError;
  constructor(detail: CorpusError) {
    super(detail.message);
    this.name = "CorpusFailure";
    this.detail = detail;
  }
}

function notImplemented(what: string): never {
  throw new CorpusFailure({
    kind: "NotImplemented",
    message: `${what} is not implemented yet — see implementation.md Phase 1.`,
  });
}

/**
 * Resolve a citation string (e.g. "347 U.S. 483") to a case with verbatim opinion text.
 *
 * Phase 1 contract:
 *  - match on the EXACT `citations[].cite` string in CAP volume metadata, never on case name
 *    (recon proved name-matching silently returns the wrong case)
 *  - fetch `casebody.opinions[].text` and join in order
 *  - cache by the corpus `analysis.sha256`
 *  - throw CorpusFailure{kind:"OutOfCoverage"} when the reporter is past its boundary
 *  - throw CorpusFailure{kind:"Unresolved"} when in-coverage but genuinely absent
 */
export async function getCaseByCitation(_citation: string): Promise<ResolvedCase> {
  return notImplemented("getCaseByCitation");
}

/** Fetch a case by its known coordinates. Used by the fixture verifier and tests. */
export async function getCaseAt(
  _reporter: string,
  _volume: number,
  _fileName: string,
): Promise<ResolvedCase> {
  return notImplemented("getCaseAt");
}

/**
 * Latest decision date we can serve for a reporter, or null if the reporter is unknown.
 * Drives UNVERIFIABLE_COVERAGE. Measured values are in fixtures/ground-truth.json.
 */
export async function coverageBoundary(_reporter: string): Promise<string | null> {
  return notImplemented("coverageBoundary");
}
