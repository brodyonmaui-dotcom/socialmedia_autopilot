// "Day N" series detection (moved here from scripts/skills/lib/backfill.ts so the web app can use it too).
// There's no series field on a post: the only signal is "Day N" in the caption or title. Pure functions.

export interface SeriesInfo {
  /** Normalized caption with the day number removed, first 6 words: groups "Day 13 of …" posts. */
  key: string;
  day: number;
}

/** Words that never identify a series (or a match). */
export const STOP_WORDS: ReadonlySet<string> = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "it", "my", "i", "this", "that", "with", "at", "be"]);

/** Lowercase, no hashtags, no punctuation (keeps $ + / - and decimal points), single spaces. */
export function normalizeCaption(text: string): string {
  return text
    .toLowerCase()
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .replace(/not financial advice\.?/g, " ")
    .replace(/[^\p{L}\p{N}\s/$+.-]/gu, " ")
    .replace(/(?<!\d)[.](?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const DAY_RE = /\bday\s*#?\s*(\d{1,4})\b/i;
export const DAY_RE_G = /\bday\s*#?\s*(\d{1,4})\b/gi;

/** "Day 13 of showing up…" → { key: "showing up…", day: 13 }; null when there's no "Day N". */
export function seriesOf(caption: string): SeriesInfo | null {
  const m = DAY_RE.exec(caption);
  if (!m) return null;
  const rest = normalizeCaption(caption.replace(DAY_RE, " ")).replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim();
  const key = rest.split(" ").filter((t) => !STOP_WORDS.has(t)).slice(0, 6).join(" ");
  return { key: key || "day-series", day: Number(m[1]) };
}
