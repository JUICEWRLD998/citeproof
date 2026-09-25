import type { Verdict } from "@/lib/types";
import styles from "./verdict.module.css";

/**
 * The verdict vocabulary, and the marks that carry it.
 *
 * Four marks in the original design; the engine produces SIX verdicts, because recon found the
 * reasons a tool cannot answer are different and a lawyer needs to know which. The extra two are not
 * extra colours — that would make the honesty layer shout, which is the opposite of its job. They are
 * the same quiet, dashed, unfilled form with a different label and a different interior, so the
 * distinction survives greyscale and every form of colour-vision deficiency.
 *
 * What each mark is allowed to signal:
 *
 *   SHAPE  carries the verdict class (positive / accusation / refusal). Always.
 *   LABEL  carries the verdict itself, in words, beside the mark. Always.
 *   HUE    reinforces a positive find or an accusation. Never the only signal, never on refusal.
 *
 * Colour is therefore never load-bearing. A reader who cannot distinguish the amber of
 * MISATTRIBUTED from the terracotta of the accent still sees an arrow leaving a frame, a different
 * word, and a different underline style.
 */

export interface VerdictStyle {
  /** Words, for the label. Lowercase: it follows a citation, it does not shout. */
  label: string;
  /** What the verdict means, in one sentence a non-lawyer can act on. */
  meaning: string;
  /** How the quotation is marked inside the document. */
  mark: string;
}

export const VERDICTS: Record<Verdict, VerdictStyle> = {
  VERIFIED: {
    label: "verified",
    meaning: "The quotation is in the case you cited, at the offset shown.",
    mark: "solid underline",
  },
  MISATTRIBUTED: {
    label: "misattributed",
    meaning: "The sentence is real, but it is not in the case you cited. We name where it lives.",
    mark: "dashed underline",
  },
  FABRICATED: {
    label: "fabricated",
    meaning: "The citation names no case, and the volume index we read was substantial enough to say so.",
    mark: "strikethrough",
  },
  UNVERIFIABLE_COVERAGE: {
    label: "out of coverage",
    meaning: "The case is real and newer than the corpus we hold. We will not call it invented.",
    mark: "dotted underline",
  },
  UNVERIFIABLE_LOW_CONFIDENCE: {
    label: "low OCR confidence",
    meaning: "The corpus text is degraded here, so an absence proves nothing either way.",
    mark: "dotted underline",
  },
  UNVERIFIABLE_UNRESOLVED: {
    label: "unresolved",
    meaning: "The citation did not resolve, and by the rule we set, that is not yet an accusation.",
    mark: "dotted underline",
  },
};

/** The CSS-module class that carries a verdict's hue. Applied to marks and labels, never to body copy. */
export function toneClass(verdict: Verdict): string {
  return {
    VERIFIED: styles.toneVerified,
    MISATTRIBUTED: styles.toneMisattributed,
    FABRICATED: styles.toneFabricated,
    UNVERIFIABLE_COVERAGE: styles.toneUnverifiable,
    UNVERIFIABLE_LOW_CONFIDENCE: styles.toneUnverifiable,
    UNVERIFIABLE_UNRESOLVED: styles.toneUnverifiable,
  }[verdict];
}

/** The CSS-module class for the mark drawn INSIDE the document text. */
export function markClass(verdict: Verdict): string {
  return {
    VERIFIED: styles.markVerified,
    MISATTRIBUTED: styles.markMisattributed,
    FABRICATED: styles.markFabricated,
    UNVERIFIABLE_COVERAGE: styles.markUnverifiable,
    UNVERIFIABLE_LOW_CONFIDENCE: styles.markUnverifiable,
    UNVERIFIABLE_UNRESOLVED: styles.markUnverifiable,
  }[verdict];
}

/**
 * The verdict's mark: drawn, never an emoji and never a check-mark glyph.
 *
 * 16-unit grid, 1.5 stroke, `currentColor` throughout so the hue comes from the tone class and the
 * shape stays legible whatever that hue becomes. Each inner glyph is a different SHAPE, which is
 * what has to survive a black-and-white print of the report.
 */
export function VerdictMark({ verdict, size = 15 }: { verdict: Verdict; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    "aria-hidden": true,
    focusable: false as const,
  };
  const ring = 6.4;
  const stroke = 1.5;

  switch (verdict) {
    case "VERIFIED":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r={ring} stroke="currentColor" strokeWidth={stroke} />
          <path
            d="M5.1 8.3l2 2 3.8-4.2"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "MISATTRIBUTED":
      // an arrow leaving the frame: the sentence is real, but it lives elsewhere
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r={ring} stroke="currentColor" strokeWidth={stroke} />
          <path d="M5.4 10.6l5.2-5.2" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
          <path
            d="M7.6 5.4h3v3"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "FABRICATED":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r={ring} stroke="currentColor" strokeWidth={stroke} />
          <path
            d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        </svg>
      );
    case "UNVERIFIABLE_COVERAGE":
      // a rule that stops: the corpus ends here
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r={ring} stroke="currentColor" strokeWidth={stroke} strokeDasharray="2.2 2.2" />
          <path d="M4.6 8h4.2" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
          <path d="M10.8 5.8v4.4" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
        </svg>
      );
    case "UNVERIFIABLE_LOW_CONFIDENCE":
      // three shrinking dots: the text is there, the reading of it is not reliable
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r={ring} stroke="currentColor" strokeWidth={stroke} strokeDasharray="1.4 2.2" />
          <circle cx="5.4" cy="8" r="1.05" fill="currentColor" />
          <circle cx="8.4" cy="8" r="0.8" fill="currentColor" />
          <circle cx="10.8" cy="8" r="0.55" fill="currentColor" />
        </svg>
      );
    default:
      // UNVERIFIABLE_UNRESOLVED — a dash where a judgement would be
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r={ring} stroke="currentColor" strokeWidth={stroke} strokeDasharray="2.2 2.2" />
          <path d="M5.4 8h5.2" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
        </svg>
      );
  }
}

/** True for the one verdict that accuses. Used by the summary so nothing else can be counted as one. */
export function isAccusation(verdict: Verdict): boolean {
  return verdict === "FABRICATED";
}
