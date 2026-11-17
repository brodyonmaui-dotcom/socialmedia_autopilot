import { classifyHook } from "../brief.js";
import type { Pillar } from "../types.js";

/**
 * One primary hook pattern per reference, built on the existing tag classifier (brief.ts classifyHook)
 * plus two shapes it doesn't tag: challenge/day-N and result-first.
 */
export const AUTO_PATTERNS = ["challenge", "question", "list", "contrarian", "how-to", "story", "result-first", "pov", "statement"] as const;
export type AutoPattern = (typeof AUTO_PATTERNS)[number];

/** Short noun phrase for "opens with a <label> hook". */
export const PATTERN_LABEL: Record<AutoPattern, string> = {
  challenge: "challenge/day-N",
  question: "question",
  list: "number/list",
  contrarian: "contrarian",
  "how-to": "how-to",
  story: "story",
  "result-first": "result-first",
  pov: "POV",
  statement: "plain statement",
};

const CHALLENGE = /\bday\s*(?:#?\d+|one|\{\{\s*N\s*\}\})(?![\w])|\b\d+[- ]day\b|\bchallenge\b|\bweek\s*#?\d+\s+of\b/i;
const RESULT_FIRST =
  /^(from\b.+\bto\b|i (finally |just )?(hit|lost|gained|made|added|ran|benched|squatted|deadlifted|passed)\b|\+?\d+(\.\d+)?\s*(lbs?|kg|pounds|kilos|%)\b|this is what \d+|here'?s what \d+)/i;
const CONTRARIAN_EXTRA = /\b(is a lie|is overrated|is a myth|isn'?t the problem|is killing your|you'?re doing it wrong)\b/i;

export function classifyPattern(hookLine: string): AutoPattern {
  const h = hookLine.trim();
  if (!h) return "statement";
  const tags = classifyHook(h);
  if (CHALLENGE.test(h)) return "challenge";
  if (tags.includes("question")) return "question";
  if (tags.includes("list")) return "list";
  if (tags.includes("contrarian") || CONTRARIAN_EXTRA.test(h)) return "contrarian";
  if (tags.includes("how-why")) return "how-to";
  if (RESULT_FIRST.test(h)) return "result-first";
  if (/^i used to\b/i.test(h) || tags.includes("story")) return "story";
  if (tags.includes("number")) return "list";
  if (tags.includes("pov")) return "pov";
  return "statement";
}

/** The three lanes the adapt templates are written for. */
export type AdaptLane = "gym" | "trading" | "other";
export function adaptLane(pillar: Pillar | string | null | undefined): AdaptLane {
  return pillar === "gym" || pillar === "trading" ? pillar : "other";
}
