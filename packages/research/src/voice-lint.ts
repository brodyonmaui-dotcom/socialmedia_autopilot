import type { Platform } from "@autopilot/core";
import type { Pillar } from "./types.js";

/**
 * Mechanical checks from docs/voice.md + the CLAUDE.md location boundary. These catch the rules a
 * script can see (counts, banned phrases, place patterns); the voice itself stays a human/Claude
 * judgment. "error" = must not ship as-is, "warn" = show it, let him decide.
 */
export type LintSeverity = "error" | "warn";
export interface LintIssue {
  rule: string;
  severity: LintSeverity;
  message: string;
}
export interface LintResult {
  ok: boolean;
  issues: LintIssue[];
}

export interface LintInput {
  text: string;
  /** caption = post text; title = YouTube title; reply/dm = engagement text (stricter: no swearing). */
  kind: "caption" | "title" | "hook" | "reply" | "dm";
  platform?: Platform;
  pillar?: Pillar | null;
  /**
   * Extra terms that must never appear (his city, school, gym…). Supplied at runtime from .env
   * (PRIVACY_BLOCKLIST), never committed — the repo is public.
   */
  blocklist?: string[];
}

/** voice.md "Hashtags": IG ≤5, TikTok 3–5, YouTube 3 (description), Snapchat 1–2 topic tags. */
export const HASHTAG_LIMITS: Record<Platform, { min: number; max: number }> = {
  instagram: { min: 0, max: 5 },
  tiktok: { min: 3, max: 5 },
  youtube: { min: 0, max: 3 },
  snapchat: { min: 0, max: 2 },
};
export const YOUTUBE_TITLE_MAX = 60;

const NFA = /not financial advice/i;
const HYPE = /\b(insane|let'?s\s+go+o*|goat|crazy gains|game ?changer|life ?changing)\b/i;
const BANNED_EMOJI = /[🔥💯🚀💪]/u;
const CTA = /\b(follow for more|follow me for|comment\s+["“']?\w+["”']?\s+(for|to get)|wait for it|link in (my )?bio|smash (that|the) like)\b/i;
const TRADE_CALL = /\b(buy|sell|long|short)\s+(here|now|this|at\s+\$?\d)|\bentry (at|@)\s*\$?\d|\bsignal(s)? (group|alert)/i;
const PLACEHOLDER = /\{\{[^}]*\}\}/;
const TRADING_RESULT = /(\bP\/?L\b|[+-]\s?\$\d|\$\d[\d,]*|\b\d+(\.\d+)?\s?R\b|\b1:\d+R\b|\bpoints?\b)/i;
const SWEAR = /\b(fuck\w*|shit\w*|damn|bitch\w*|ass(hole)?|crap|hell)\b/i;
/** Real-time whereabouts: "right now at…", "heading to…", "on my way to…". */
const REALTIME = /\b(right now|rn|currently)\b[^.!?\n]{0,30}\b(at|in)\s+(the\s+)?[A-Z]|\b(heading|on my way|omw|walking|driving)\s+to\b|\bcome (find|see) me\b/i;
/** "<Proper Name> Gym/Park/Trail/University…" — an identifiable place. */
const NAMED_PLACE =
  /\b[A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*)*\s+(Gym|Fitness|Athletic Club|Park|Trail|Trailhead|Beach|University|College|Campus|High School|Mall|Stadium|Lake|Mountain|Street|Avenue|Ave|Road|Rd|Boulevard|Blvd)\b/;
const UNIVERSITY_OF = /\bUniversity of [A-Z]/;
const COORDS = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/;
/** Acronyms he really uses (voice.md trading rules), so the all-caps check leaves them alone. */
const CAPS_OK = new Set(["ICT", "SMT", "BOS", "NASDAQ", "NQ", "ES", "FOMC", "CPI", "NFP", "PA", "BE", "RR", "PT", "PR", "AM", "PM", "OK", "USA"]);

function countEmojiGraphemes(text: string): number {
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  let n = 0;
  for (const { segment } of seg.segment(text)) if (/\p{Extended_Pictographic}/u.test(segment)) n++;
  return n;
}

export function hashtags(text: string): string[] {
  return text.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.map((h) => h.trim().toLowerCase()) ?? [];
}

export function lintText(input: LintInput): LintResult {
  const { text, kind, platform, pillar } = input;
  const issues: LintIssue[] = [];
  const add = (rule: string, severity: LintSeverity, message: string) => issues.push({ rule, severity, message });

  // ---- privacy (CLAUDE.md non-negotiable 5) — always errors ----
  if (REALTIME.test(text)) add("privacy.realtime", "error", "pairs a place or movement with right now");
  if (NAMED_PLACE.test(text) || UNIVERSITY_OF.test(text)) add("privacy.place", "error", "names an identifiable place");
  if (COORDS.test(text)) add("privacy.coords", "error", "contains coordinates");
  for (const term of input.blocklist ?? []) {
    const t = term.trim();
    if (t && text.toLowerCase().includes(t.toLowerCase())) add("privacy.blocklist", "error", "contains a blocklisted private term");
  }

  // ---- numbers (voice.md: never invent) ----
  if (PLACEHOLDER.test(text)) add("numbers.placeholder", "error", "still has a {{placeholder}}: needs the real number from him");

  // ---- tone ----
  if (HYPE.test(text)) add("tone.hype", "error", "hype language");
  if (BANNED_EMOJI.test(text)) add("tone.emoji-hype", "error", "uses 🔥💯🚀💪");
  if (CTA.test(text)) add("tone.cta", "error", "engagement-bait call to action");
  if (TRADE_CALL.test(text)) add("trading.call", "error", "reads as a trade call or signal");
  const shouting = (text.match(/\b[A-Z]{4,}\b/g) ?? []).filter((w) => !CAPS_OK.has(w));
  if (shouting.length) add("tone.caps", "warn", `all-caps word(s): ${shouting.slice(0, 3).join(", ")}`);
  if (/!/.test(text)) add("tone.exclamation", "warn", "exclamation mark (fine only if sarcastic)");

  const emojis = countEmojiGraphemes(text);
  const listy = pillar === "meal" && kind === "caption"; // meal-prep lists may carry food emojis
  if (!listy && emojis > 1) add("tone.emoji-count", kind === "reply" ? "warn" : "error", `${emojis} emojis (max 1)`);

  if ((kind === "reply" || kind === "dm") && SWEAR.test(text)) add("tone.swear", "error", "auto-replies and DM drafts never swear");
  if (kind === "reply") {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    if (words > 6) add("reply.length", "warn", `${words} words (replies are 2–6)`);
  }

  // ---- platform mechanics ----
  if (kind === "title") {
    if ([...text].length > YOUTUBE_TITLE_MAX) add("youtube.title", "error", `title over ${YOUTUBE_TITLE_MAX} chars`);
  }
  if (kind === "caption" && platform) {
    const n = hashtags(text).length;
    const { min, max } = HASHTAG_LIMITS[platform];
    if (n > max) add("hashtags.max", platform === "instagram" ? "error" : "warn", `${n} hashtags (${platform} max ${max})`);
    else if (n < min) add("hashtags.min", "warn", `${n} hashtags (${platform} wants ${min}–${max})`);
  }

  // ---- trading ----
  if (kind === "caption" && pillar === "trading" && TRADING_RESULT.test(text) && !NFA.test(text)) {
    add("trading.nfa", "warn", 'mentions a result or setup without "Not financial advice."');
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

/** Reads PRIVACY_BLOCKLIST (comma-separated, .env only). */
export function blocklistFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  return (env.PRIVACY_BLOCKLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
