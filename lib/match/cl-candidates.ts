import type { ResolvedCase, Span } from "../types";
import { findQuoteIn } from "./match";
import type { ClSearchHit } from "../resolve/courtlistener";
import { Corpus } from "../corpus";
import type { MisattributionHit } from "./misattribution";

/**
 * CourtListener as a CANDIDATE SOURCE for a true home — verified, bounded, and optional.
 *
 * ## Why this is not the primary resolver
 *
 * `.recon/probe-misattribution.mjs` measured two things that decide this file's design:
 *
 * 1. **CL returns the cases that QUOTE a sentence, not the case it originated in.** Asked for
 *    Brown's holding, the top hits were `570 U.S. 297`, `51 F.3d 440`, `671 F.3d 611` — quoting
 *    cases. 123 cases contain that sentence; Brown is not among CL's top hits. So a CL result is a
 *    lead about *somewhere the sentence appears*, never a claim about where it came from.
 * 2. **CL carries no opinion text** (401 on `/opinions/<id>/`, §3.4). So a CL hit cannot even be
 *    *checked* without a second source.
 *
 * The same probe measured that CL returns ZERO for the invented E5 sentence and zero for the E3
 * paraphrase — better than it could be trusted for, and not something this file relies on.
 *
 * ## The rule this file enforces
 *
 * **A CL hit becomes a candidate only after its citation is resolved through CAP and the quotation
 * is found verbatim in the resolved opinion text.** An unresolved hit, a hit with no citation, or
 * a citation CAP cannot reach produces NO candidate. That is what keeps this from becoming the
 * "confident wrong home" the plan warns is worse than no feature: nothing is reported here that
 * has not been checked against primary source, by the same matcher that checks the user's own text.
 *
 * Bounded on both sides — one CL query per audit, and a small cap on CAP lookups — because the
 * anonymous CL budget is ~5 requests/minute and CAP is a shared third-party host.
 */

export interface ClCandidateOptions {
  /**
   * Hits the cross-check already returned, from `CascadeOutcome.crossCheckHits`.
   *
   * Passed IN rather than searched for here. The cascade already issues one query per citation; a
   * second query from this module would cost two requests per audited item against an anonymous
   * budget of roughly 5/minute. A test caught exactly that, and the fix is one search per item,
   * reused. This function's job is VERIFICATION — the searching is done upstream.
   */
  hits: ClSearchHit[];
  /** Used to read the text a hit must be verified against. */
  corpus?: Corpus;
  /** How many hits to attempt to verify. Each costs one CAP resolution. */
  maxLookups?: number;
  /** Citations already accounted for (the cited case), so it is never named as its own home. */
  exclude?: string[];
}

/** One CL hit, and what became of it. Returned so the attempt log can show the work. */
export interface ClCandidateAttempt {
  hit: ClSearchHit;
  outcome: "verified" | "no-citation" | "unresolvable" | "not-found-in-text" | "excluded";
  detail: string;
  /** Present only for `verified`. */
  hitResult?: MisattributionHit;
}

export interface ClCandidateSearch {
  attempts: ClCandidateAttempt[];
  /** Verified candidates only, in the order CL returned them. */
  verified: MisattributionHit[];
}

/**
 * Turn already-fetched CL hits into VERIFIED candidates.
 *
 * Note this deliberately does NOT rank by date: its caller merges these with the local scan and
 * ranks the union, so that one ranking rule covers both sources rather than two rules that could
 * disagree.
 */
export async function verifyTrueHomeCandidates(
  quotation: string,
  opts: ClCandidateOptions,
): Promise<ClCandidateSearch> {
  const corpus = opts.corpus ?? new Corpus();
  const maxLookups = opts.maxLookups ?? 3;
  const excluded = new Set(
    (opts.exclude ?? []).map((c) => c.replace(/\s+/g, " ").trim().toUpperCase()),
  );

  const attempts: ClCandidateAttempt[] = [];
  const verified: MisattributionHit[] = [];

  let lookups = 0;
  for (const hit of opts.hits) {
    if (lookups >= maxLookups) {
      attempts.push({ hit, outcome: "unresolvable", detail: `lookup cap of ${maxLookups} reached` });
      continue;
    }
    // A hit's own citation list is the only addressable part of it — the snippet cannot be
    // resolved to text, and CL gives us no full opinion.
    const candidateCite = hit.citations.find((c) => !excluded.has(c.replace(/\s+/g, " ").trim().toUpperCase()));
    if (!candidateCite) {
      attempts.push({
        hit,
        outcome: hit.citations.length ? "excluded" : "no-citation",
        detail: hit.citations.length
          ? "every citation this hit carries is already accounted for"
          : "hit carries no citation, so it cannot be resolved to text",
      });
      continue;
    }
    if (excluded.has(candidateCite.replace(/\s+/g, " ").trim().toUpperCase())) {
      attempts.push({ hit, outcome: "excluded", detail: `${candidateCite} is the cited case` });
      continue;
    }

    lookups++;
    let resolved: ResolvedCase;
    try {
      resolved = await corpus.getCaseByCitation(candidateCite);
    } catch (err) {
      attempts.push({
        hit,
        outcome: "unresolvable",
        detail: `${candidateCite}: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    // THE VERIFICATION. Without this step the tool would name a case on the strength of a search
    // result, which is precisely the failure mode the whole product is built to avoid. `findQuoteIn`
    // is the EXACT normalised matcher — deliberately not `findBestMatch`, because a fuzzy hit here
    // would name a case whose text merely resembles the quotation.
    const span = findQuoteIn(resolved.text, quotation);
    if (!span) {
      attempts.push({
        hit,
        outcome: "not-found-in-text",
        detail: `${candidateCite} resolved but the quotation is not in its text verbatim`,
      });
      continue;
    }

    attempts.push({
      hit,
      outcome: "verified",
      detail: `${candidateCite} contains the quotation verbatim at chars ${span.start}-${span.end}`,
    });
    verified.push({ case: resolved, span: span as Span });
  }

  return { attempts, verified };
}
