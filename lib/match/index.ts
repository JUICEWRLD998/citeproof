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
  type MisattributionHit,
  type MisattributionScanOptions,
} from "./misattribution";
