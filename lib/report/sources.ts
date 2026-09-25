import index from "@/fixtures/corpus/index.json";

/**
 * Where a resolved case's bytes can be READ by a third party.
 *
 * The report's whole claim is that every verdict can be re-run against primary source, so a verdict
 * that does not link to the text it was decided on is an assertion rather than a receipt.
 *
 * Two destinations, and the label always says which one it is:
 *
 *  - `static.case.law` — the exact case file, WHEN its coordinates are known. They are known for
 *    everything in the curated fixture index, which is also what the keyless demo resolves against.
 *  - A CourtListener citation search — for a case fetched live. The corpus layer knows the case file
 *    name internally, but `ResolvedCase` does not carry it, and reconstructing `<page>-01` would
 *    produce a confidently wrong URL: `lib/corpus/cache.ts` and the Phase 1 receipts both record
 *    that one page can hold MANY records (`1082-01`, `1082-02`, …). So the fallback is a search on
 *    the citation string — a real page that will show the right case — labelled as a search rather
 *    than dressed up as a deep link.
 */
export interface SourceLink {
  href: string;
  label: string;
  /** True only for a direct link to the case file we read. Never true for the search fallback. */
  direct: boolean;
}

interface IndexEntry {
  citation: string;
  reporter: string;
  volume: number;
  caseFile: string;
  allCitations: string[];
}

/**
 * The curated index, imported rather than read from disk so it is bundled with the server code.
 *
 * Importing matters for deployment: the corpus layer reads `fixtures/corpus/*.json` from
 * `process.cwd()` at call time, which works in `next start` from the repo root but not in a
 * serverless bundle unless the files are traced in. This table is small and fixed, so it travels
 * with the code.
 */
const INDEX: IndexEntry[] = (index as { cases: IndexEntry[] }).cases;

/** citation (upper-cased, whitespace-normalised) -> coordinates. Includes parallel citations. */
const BY_CITATION = new Map<string, IndexEntry>();
for (const entry of INDEX) {
  for (const cite of [entry.citation, ...(entry.allCitations ?? [])]) {
    if (cite) BY_CITATION.set(canonical(cite), entry);
  }
}

function canonical(citation: string): string {
  return citation.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * The report's source link for a case.
 *
 * `citations` is every citation the case carries, because a document may cite Brown as
 * `74 S. Ct. 686` — a parallel reporter that reaches the same file. Matching only the canonical
 * spelling would fall back to a search for a case we in fact hold.
 */
export function caseSourceLink(caseName: string, citations: readonly string[]): SourceLink {
  for (const cite of citations) {
    const entry = BY_CITATION.get(canonical(cite));
    if (!entry) continue;
    return {
      href: `https://static.case.law/${entry.reporter}/${entry.volume}/cases/${entry.caseFile}.json`,
      label: `static.case.law/${entry.reporter}/${entry.volume}/cases/${entry.caseFile}.json`,
      direct: true,
    };
  }
  // No coordinates we trust. A search on the canonical citation is a real, checkable page; a
  // guessed case-file URL would be a fabricated deep link, which is the failure this product
  // exists to catch in other people's work.
  const query = citations[0] ?? caseName;
  return {
    href: `https://www.courtlistener.com/?q=${encodeURIComponent(`"${query}"`)}&type=o`,
    label: `courtlistener.com search for "${query}"`,
    direct: false,
  };
}

/** Exported for the test that pins the fallback: an unknown citation must never yield a direct link. */
export const SOURCE_INDEX_SIZE = BY_CITATION.size;
