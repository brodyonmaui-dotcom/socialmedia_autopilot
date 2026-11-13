import { lintText } from "@autopilot/research";
import type { InboundComment, TriageResult } from "./types.js";

/**
 * Hard rules around the model (docs/voice.md "Comment replies (auto)"). preRules runs before the
 * model and can short-circuit it; postRules checks whatever the model drafted. Both only ever make
 * things more cautious: a rule can turn a reply into a flag, never the other way round.
 */
export interface RuleHit {
  bucket: "flag" | "hide_flag";
  reason: string;
}

export const MIN_CONFIDENCE = 0.7;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole words/phrases, optional plural ("sponsors", "parks"), case-insensitive. */
const words = (terms: string[]) => new RegExp(`\\b(?:${terms.map(escape).join("|")})s?\\b`, "i");

const LINK = /http|www\.|\.com|t\.me|wa\.me|linktr/i;
const LOCATION = words([
  "where", "location", "address", "gym", "trail", "park", "beach", "city", "town", "near",
  "what time", "when do you", "schedule", "tomorrow", "tonight", "meet", "meet up", "visit",
]);
const BUSINESS = words([
  "collab", "collaboration", "sponsor", "brand", "partnership", "ambassador", "promo", "dm me", "dm us",
  "business", "rate card", "pricing", "coaching", "mentorship", "signals", "join my", "telegram", "whatsapp",
  "crypto group",
]);
/** Conservative: slurs/threats/doxxing/scams go to the inbox (+ optional hide), never a reply. */
const HIDE: Array<[RegExp, string]> = [
  [/\bkill yourself\b/i, "threat"],
  [/\bkys\b/i, "threat"],
  [/\bi know where you live\b/i, "doxxing"],
  [/\byour address is\b/i, "doxxing"],
  [/\d{3}[-. ]\d{3}[-. ]\d{4}/, "phone number"],
  [/\bsend me \$/i, "scam"],
  [/\bgiveaway winner\b/i, "scam"],
  [/\bcash app\b/i, "scam"],
  [/\bwallet address\b/i, "scam"],
];
/**
 * Market sessions/exchanges are trading talk, not places (run-2-decisions.md F7 #2). They're
 * removed before the keyword + blocklist checks so they never flag on their own.
 */
const MARKET_TERMS = /\b(?:ny|nyc|new york|london|asia|asian|tokyo|sydney|frankfurt|europe|european)\s+(?:session|open|close|kill ?zone)s?\b|\bnyse\b|\bnasdaq\b/gi;

function hitsBlocklist(text: string, blocklist: string[]): boolean {
  const lower = text.toLowerCase();
  return blocklist.some((t) => {
    const term = t.trim().toLowerCase();
    return term !== "" && lower.includes(term);
  });
}

export function preRules(c: InboundComment, blocklist: string[] = []): RuleHit | null {
  if (c.isOwn) return { bucket: "flag", reason: "own comment" };
  const raw = c.text;
  const hide = HIDE.filter(([re]) => re.test(raw)).map(([, why]) => why);
  if (hide.length) return { bucket: "hide_flag", reason: [...new Set(hide)].join(", ") };

  const text = raw.replace(MARKET_TERMS, " ");
  const reasons: string[] = [];
  if (text.includes("?")) reasons.push("question");
  if (LINK.test(text)) reasons.push("link");
  if (LOCATION.test(text)) reasons.push("location/schedule");
  if (BUSINESS.test(text)) reasons.push("brand/business");
  if (hitsBlocklist(text, blocklist)) reasons.push("blocklist");
  return reasons.length ? { bucket: "flag", reason: reasons.join(", ") } : null;
}

/** Words, not counting pure-emoji tokens. */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w && /[\p{L}\p{N}]/u.test(w)).length;
}

export function postRules(r: TriageResult, c: InboundComment, blocklist: string[] = []): TriageResult {
  void c; // part of the contract; current checks only need the draft
  if (r.bucket === "flag" || r.bucket === "hide_flag") return r;
  const toFlag = (reasons: string[]): TriageResult => ({ ...r, bucket: "flag", reasons: [...r.reasons, ...reasons] });
  if (r.reply === null || r.reply.trim() === "") return toFlag(["no draft"]);

  const reply = r.reply;
  const reasons: string[] = [];
  if (r.refused) reasons.push("model refused");
  const lint = lintText({ text: reply, kind: "reply", blocklist });
  const errors = lint.issues.filter((i) => i.severity === "error").map((i) => i.rule);
  if (errors.length) reasons.push(`lint: ${errors.join(", ")}`);
  const n = wordCount(reply);
  if (n < 2 || n > 8) reasons.push(`length ${n} words`);
  if (!(r.confidence >= MIN_CONFIDENCE)) reasons.push("low confidence");
  if (reply.includes("?")) reasons.push("reply asks a question");
  if (LINK.test(reply)) reasons.push("reply has a link");
  return reasons.length ? toFlag(reasons) : r;
}
