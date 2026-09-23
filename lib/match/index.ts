export { normalize, normalizeWithMap, type NormalizedText, type OriginRange } from "./normalize";
export {
  findQuote,
  findQuoteIn,
  findAllQuotes,
  findBestMatch,
  locateInDocument,
  type MatchResult,
} from "./match";
export {
  scanForTrueHome,
  findTrueHome,
  rankTrueHomes,
  type MisattributionHit,
  type MisattributionScanOptions,
  type RankedTrueHomes,
} from "./misattribution";
export {
  verifyTrueHomeCandidates,
  type ClCandidateAttempt,
  type ClCandidateOptions,
  type ClCandidateSearch,
} from "./cl-candidates";
