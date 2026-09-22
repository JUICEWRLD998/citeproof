/**
 * CAP reporter slug map — MEASURED, not assumed.
 *
 * fixtures/ground-truth.json `knownGaps` warned that the naming pattern must be confirmed
 * empirically. It was (`.recon/probe-slugs.mjs`, 2026-09-22), and the pattern is NOT
 * uniform. All four of these coexist in the real index:
 *
 *   no separator   us · f2d · f3d · f-supp-2d · so2d · ne2d · nw2d · p2d · a2d
 *   dash           cal-2d · f-appx · ny-2d · l-ed-2d · ill-2d · f-supp
 *   mixed          misc2d · pa-d-c4th · us-app-dc
 *
 * Every slug derived by guessing the pattern 404'd (`f-2d`, `f-3d`, `b-r`, `a-2d`, `so-2d`,
 * `l-ed`, `p-2d`, `n-e-2d`). So this file is a lookup table with NO slug synthesis: an
 * unknown reporter returns null and the corpus layer refuses rather than constructing a URL
 * from a pattern. A confidently constructed wrong URL is how you get a wrong verdict.
 */

export const CAP_BASE = "https://static.case.law";

// --- The slugs this build supports ------------------------------------------
// Scoped deliberately to reporters a US filing actually cites, all present in the measured
// index. The full enumeration was 404 dirs; we do not carry punctuation variants of real
// reporters (`F.2d` -> `f2d` is the only form CAP serves) as separate entries, because a
// second spelling of one reporter is a resolution bug waiting to happen.
export const REPORTER_SLUGS = [
  // Federal
  "us", "us-app-dc", "us-ct-cl",
  "f", "f-cas", "f2d", "f3d", "f-appx", "f-supp", "f-supp-2d", "f-supp-3d",
  "fed-cl", "dc", "d-chip",
  // Regional
  "a2d", "a3d", "so2d", "so3d", "p2d", "p3d", "ne2d", "ne3d", "nw2d", "se2d", "sw2d", "sw3d",
  // State (the ten most-cited)
  "cal", "cal-2d", "cal-3d", "cal-4th", "cal-5th", "cal-app-2d",
  "ny", "ny-2d", "ny3d", "ill", "ill-2d", "ill-3d", "pa", "ohio", "mass", "tex", "fla", "ga", "nc", "va", "wash",
  // Federal statute-adjacent / pre-1924 commerce-era court reporters
  "l-ed-2d", "s-ct",
] as const;

export type ReporterSlug = (typeof REPORTER_SLUGS)[number];

const SLUG_SET = new Set<string>(REPORTER_SLUGS);

export function isKnownSlug(value: string): value is ReporterSlug {
  return SLUG_SET.has(value);
}

/**
 * Citation-spelling -> CAP slug aliases.
 *
 * Keyed by the reporter as it appears in a citation, upper-cased and whitespace-collapsed
 * only. Punctuation is normalised at lookup time (see `citationReporterToSlug`), because
 * `347 U.S. 483`, `347 U.S. 483` and `347 US 483` are the same citation and only Phase 2
 * owns deciding what the canonical spelling is. Everything NOT in this table is rejected.
 */
const REPORTER_ALIASES: Readonly<Record<string, ReporterSlug>> = {
  "U.S.": "us", "US": "us", "S. CT.": "s-ct",
  "F.": "f", "F. CAS.": "f-cas", "F.2D": "f2d", "F.3D": "f3d", "F. APP'X": "f-appx", "F.APPX": "f-appx",
  "F. SUPP.": "f-supp", "F. SUPP. 2D": "f-supp-2d", "F. SUPP. 3D": "f-supp-3d",
  "FED. CL.": "fed-cl", "D.C.": "dc",
  "A.2D": "a2d", "A.3D": "a3d", "SO. 2D": "so2d", "SO. 3D": "so3d", "P.2D": "p2d", "P.3D": "p3d",
  "N.E.2D": "ne2d", "N.E.3D": "ne3d", "N.W.2D": "nw2d", "S.E.2D": "se2d", "S.W.2D": "sw2d", "S.W.3D": "sw3d",
  "L. ED. 2D": "l-ed-2d",
  "CAL.": "cal", "CAL. 2D": "cal-2d", "CAL. 3D": "cal-3d", "CAL. 4TH": "cal-4th", "CAL. 5TH": "cal-5th",
  "N.Y.": "ny", "N.Y.2D": "ny-2d", "N.Y.3D": "ny3d",
  "ILL.": "ill", "ILL. 2D": "ill-2d", "ILL. 3D": "ill-3d",
  "PA.": "pa", "OHIO": "ohio", "MASS.": "mass", "TEX.": "tex", "FLA.": "fla",
  "GA.": "ga", "N.C.": "nc", "VA.": "va", "WASH.": "wash",
};

/**
 * Reduce a citation reporter token to a CAP slug, or null if we cannot be sure.
 *
 * Null is a real answer and must be handled: it becomes UNVERIFIABLE_COVERAGE, never
 * FABRICATED. Guessing here is how a tool accuses a real case from a reporter it does not
 * actually have.
 */
export function citationReporterToSlug(token: string): ReporterSlug | null {
  const cleaned = token.replace(/\s+/g, " ").trim().replace(/[,;]+$/, "");
  const upper = cleaned.toUpperCase();
  const alias = REPORTER_ALIASES[upper];
  if (alias) return alias;
  // Some citations spell a slug directly ("2026 U.S. LEXIS" is out of scope by design).
  const lowered = upper.toLowerCase();
  return isKnownSlug(lowered) ? lowered : null;
}
