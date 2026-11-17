import { lintText } from "@autopilot/research";
import type { EngagementPlatform, InboundComment, PromoAccount, TriageResult } from "./types.js";

/**
 * Hard rules around the model (docs/voice.md "Comment replies (auto)"). preRules runs before the
 * model and can short-circuit it; postRules checks whatever the model drafted. Both only ever make
 * things more cautious: a rule can turn a reply into a flag (or promo spam into "never reply"),
 * never the other way round.
 *
 * Precedence (run 4): own comment → HIDE (threats, doxxing, scams) → whereabouts/blocklist →
 * promo spam → questions, links, business. Location and HIDE beat promo, so a spammer asking
 * "where is this gym" still reaches the creator; promo beats link/business, so "DM us for promo"
 * no longer flags.
 */
export interface RuleHit {
  bucket: "flag" | "hide_flag" | "spam_promo";
  reason: string;
}
export interface PromoHit {
  bucket: "spam_promo";
  /** "promo:<rule id>" */
  reason: string;
}
export interface PreRuleOptions {
  /** engagement_promo_accounts (open rows). */
  promoAccounts?: readonly PromoAccount[];
  /** "Not spam": re-run without the promo rule for this one item. */
  skipPromo?: boolean;
}
export interface PostRuleOptions {
  /** false after "Not spam": a model promo verdict becomes a flag (the creator said it isn't). */
  allowPromo?: boolean;
}

export const MIN_CONFIDENCE = 0.7;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole words/phrases, optional plural ("sponsors", "partnerships"), case-insensitive. */
const words = (terms: string[]) => new RegExp(`\\b(?:${terms.map(escape).join("|")})s?\\b`, "i");
/** Curly apostrophes → straight, so "we’d" matches "we'd". */
const norm = (s: string) => s.replace(/[‘’ʼ]/g, "'");

const LINK = /http|www\.|\.com|t\.me|wa\.me|linktr/i;

/**
 * Whereabouts questions or requests only (run 4 recalibration). Bare topical words ("gym", "park",
 * "beach", "trail", "city", "tomorrow", "tonight", "near", "visit", "schedule", "meet") no longer flag
 * on their own: "love the gym content" is praise. Anything with "where" still flags.
 */
const LOCATION_RES: RegExp[] = [
  /\bwhere\b/i,
  /\b(?:which|what|wat|wht|whats|what's)\s+(?:gym|trail|park|beach|city|town|place|spot|area|state|country|neighbou?rhood|location|club|studio|track|court|field|street|mall|school|college|campus|office|building|hood|lake|mountain|part\s+of|side\s+of)s?\b/i,
  /\b(?:your|ur|you're|youre)\s+(?:address|location|whereabouts|zip|postcode|neighbou?rhood|area|hood|hometown|home\s+town)\b/i,
  /\b(?:address|whereabouts|coordinates)\b/i,
  /\blocation\b/i,
  /\b(?:are|r)\s+(?:you|u|ya)\s+(?:in|near|from|around|at|based|located|living|still\s+in|ever\s+in)\b/i,
  /\b(?:you|u)\s+(?:based|located)\b/i,
  /\b(?:near|around|by)\s+(?:you|u|ya|your\s+place|ur\s+place)\b/i,
  /\bnear\s+me\b/i,
  /\b(?:come|coming)\s+(?:to\s+)?(?:train|lift|work\s?out|meet|visit|see\s+you)\b/i,
  /\b(?:can|could|should|shall|let'?s|lets|wanna|want\s+to|we\s+should|i\s+want\s+to)\s+(?:we\s+|i\s+|u\s+|you\s+)?(?:meet|link\s+up|hang\s+out|train\s+together|lift\s+together|visit\s+you)\b/i,
  /\bmeet\s?up\b/i,
  /\bmeet\s+(?:you|u|ya|irl|in\s+person)\b/i,
  /\bsee\s+(?:you|u|ya)\s+(?:at|there|in|around)\b/i,
  /\bwhen\s+(?:are|r|do|will|is|does|would)\s+(?:you|u|ya|he)\b/i,
  /\bwhen\s+(?:u|you|ya)\s+(?:there|going|training|lifting)\b/i,
  /\bwhat\s+time\b/i,
  /\b(?:your|ur)\s+(?:schedule|training\s+times?|gym\s+times?)\b/i,
  /\bhow\s+(?:far|close)\s+(?:is|are)\b/i,
  // F7 C6 red-team: whereabouts phrasings without "where"/"?"
  words(["live in", "living in", "based in", "located", "train in", "train at", "train with", "come train", "lift at", "work out at", "workout at"]),
];
/** Street-address shapes ("12 Oak Ridge St", "600 main rd") and US ZIP codes (F7 C6). A false flag only costs a manual look. */
const ADDRESS = /\b\d{1,5}\s+(?:[a-z]+\s+){1,2}(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|hwy|highway|pl|place)\b/i;
/** Five digits, not money/P&L or a count ("+12500", "$10000", "10000 subs"). */
const ZIP = /(?<![$+\-.,\d])\b\d{5}(?:-\d{4})?\b(?!\s*(?:k\b|%|\$|usd|dollars|likes|views|subs|subscribers|followers|points|pts|ticks|reps|lbs|kg|calories|cals|steps))/i;

/** Real business approaches only; bare "brand", "business", "pricing", "promo" inside praise don't flag (run 4). */
const BUSINESS = new RegExp(
  [
    words([
      "collab", "collaboration", "collaborate", "sponsor", "sponsorship", "sponsored", "partnership", "partner with", "ambassador",
      "rate card", "your rates", "ur rates", "media kit", "business inquiry", "business enquiry", "business email", "brand deal",
      "work with you", "paid partnership", "pr package", "coaching", "mentorship", "signals", "signal group", "join my", "join our",
      "telegram", "whatsapp", "crypto group", "dm me", "dm us", "campaign",
    ]).source,
    /\bdo\s+(?:you|u)\s+(?:offer|sell|do)\s+(?:coaching|programs?|plans?|1:1|one\s+on\s+one|lessons|courses?)\b/.source,
  ].join("|"),
  "i",
);
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

// ---- promo spam (run 4) ----
const HANDLE = String.raw`@[\w.]+`;
/** "I'll send this to @mybro" is a fan sharing, not promo. */
const FIRST_PERSON_BEFORE = /\b(?:i|i'll|ill|im|i'm|imma|gonna|will|just|already|def|definitely)\s+(?:\w+\s+)?$/i;
const PROMO: Array<[RegExp, string, { firstPersonOk?: boolean }?]> = [
  [new RegExp(String.raw`\b(?:send|submit|post|repost)(?:ing)?\s+(?:(?:it|this|that|them|yours?|ur|the|this\s+one)\s+(?:\w+\s+)?)?(?:to|on|over\s+to|via|at)?\s*${HANDLE}`, "i"), "send-to"],
  [new RegExp(String.raw`\b(?:dm|message|inbox|text|hmu|contact)\s+(?:us|${HANDLE}|our\s+page|the\s+page)\b[^.!?\n]{0,30}?\b(?:feature[ds]?|featuring|promo(?:tion)?s?|promote|collab|shout\s?outs?|repost|exposure)\b`, "i"), "dm-feature"],
  [new RegExp(String.raw`\bpromote\s+(?:it|this|that|you|ur|your\s+\w+(?:\s+\w+)?)\s+(?:on|at|with|via|through)\s+(?:${HANDLE}|our\s+page)`, "i"), "promote-on"],
  [new RegExp(String.raw`\bpromote\s+your\s+(?:content|page|account|channel|videos?)\s+with\s+${HANDLE}`, "i"), "promote-on"],
  [/\b(?:get|getting|be|being)\s+featured\b/i, "get-featured"],
  [/\bwe(?:'d|\s+would)?\s+(?:love|like|want)\s+to\s+feature\s+(?:you|ur|your)\b/i, "feature-you"],
  [/\bpaid\s+(?:promo(?:tion)?s?|shout\s?outs?|features?|posts?|reposts?)\b|\bpromo(?:tion)?\s+(?:packages?|services?)\b/i, "paid-promo"],
  [/\bshout\s?out\s+for\s+(?:a\s+)?shout\s?out\b|\bs4s\b|\bf4f\b|\bl4l\b|\bfollow\s+for\s+(?:a\s+)?follow\b/i, "s4s"],
  [/\bcheck\s+(?:out\s+)?(?:our|my)\s+(?:page|profile|account|ig|channel|bio|insta)\b/i, "check-our-page"],
  [
    /\b(?:grow|boost|increase|skyrocket|10x)\s+(?:your|ur)\s+(?:page|account|followers|following|engagement|reach|audience|channel|views)\b|\b(?:buy|cheap|real|organic|instant)\s+(?:\d+k?\s+)?(?:followers|likes|views|subscribers|subs)\b|\bgain\s+(?:\d+k?\s+)?(?:real\s+)?followers\b|\bpromot(?:e|ion|ing)\s+(?:for|of)\s+(?:your|ur)\s+(?:page|account|content|channel)\b/i,
    "growth",
  ],
  // Generic "<praise> + send/DM/submit to @handle" shape (first-person sharing excluded).
  [new RegExp(String.raw`\b(?:send|dm|submit)\b[^.!?\n@]{0,20}${HANDLE}`, "i"), "praise-send"],
];

/** engagement_promo_accounts.author_key: the stable platform author id when we have it, else the lower-cased handle. */
export function promoAuthorKey(authorId: string | null | undefined, handle?: string | null): string | null {
  const id = authorId?.trim();
  if (id) return id;
  const h = handle?.trim().replace(/^@+/, "").toLowerCase();
  return h ? h : null;
}

function onPromoList(author: PromoAuthor | null | undefined, list: readonly PromoAccount[]): boolean {
  if (!author || list.length === 0) return false;
  const id = author.authorId?.trim() || null;
  const handle = author.authorHandle?.trim().replace(/^@+/, "").toLowerCase() || null;
  return list.some((a) => a.platform === author.platform && ((id !== null && a.authorKey === id) || (handle !== null && a.authorKey === handle)));
}

export interface PromoAuthor {
  platform: EngagementPlatform;
  authorId: string | null;
  authorHandle?: string | undefined;
}

/**
 * Promo spam: the author is on the promo list, or the text has a promo shape. Conservative: merely
 * mentioning another @handle ("@friend look at this") is not promo. Pure.
 */
export function promoRule(text: string, author?: PromoAuthor | null, promoAccounts: readonly PromoAccount[] = []): PromoHit | null {
  if (onPromoList(author, promoAccounts)) return { bucket: "spam_promo", reason: "promo:list" };
  const t = norm(text);
  for (const [re, id] of PROMO) {
    const m = re.exec(t);
    if (!m) continue;
    if ((id === "send-to" || id === "praise-send") && FIRST_PERSON_BEFORE.test(t.slice(0, m.index))) continue;
    return { bucket: "spam_promo", reason: `promo:${id}` };
  }
  return null;
}

// ---- questions ----
/** Interrogative start. Aux verbs count only with a subject ("do you…", "is this…"); "do more of these" is not a question. */
const INTERROGATIVE =
  /^\s*(?:@[\w.]+\s+)*(?:(?:bro|man|yo|ok|okay|wait|so|hey)[\s,]+)?(?:who|what|whats|what's|when|where|why|how|hows|how's|which|whose|(?:do|does|did|are|r|is|was|were|can|could|would|will|should|have|has)\s+(?:you|u|ya|ur|your|this|that|it|there|he|we|i|these|those)\b)/i;
/** Exclamations that start like questions: "what a lift", "how clean is that". */
const EXCLAMATORY = /^\s*(?:what\s+an?\b|how\s+(?:good|clean|strong|smooth|crazy|nice|sick|cool|insane)\b)/i;
const HYPE = /🔥|💯|🤯|😮|😳|😱|🙌|👏|🐐|\b(?:insane|so good|this good|so clean|so strong|crazy|nuts|unreal|goat|beast)\b/i;
/** Words that make even a rhetorical-looking question a real one (whereabouts topics). */
const TOPIC = /📍|\b(?:gym|trail|park|beach|city|town|place|spot|area|live|living|train|lift|meet|there|when|time|today|tomorrow|tonight)\b/i;

export function isQuestion(text: string): boolean {
  if (text.includes("?")) return true;
  return INTERROGATIVE.test(text) && !EXCLAMATORY.test(text);
}

/**
 * "how are you this good?!", "bro what 🔥?": question-shaped praise. The pre-rules let these through to
 * the model (which may call them simple_positive with confidence ≥ MIN_CONFIDENCE); they don't decide it.
 */
export function isRhetoricalPraise(text: string): boolean {
  if (!isQuestion(text) || TOPIC.test(text)) return false;
  return /\?!|!\?/.test(text) || (/^\s*(?:(?:bro|man|yo)\s+)?(?:what|how)\b/i.test(text) && HYPE.test(text));
}

function hitsBlocklist(text: string, blocklist: string[]): boolean {
  const lower = text.toLowerCase();
  return blocklist.some((t) => {
    const term = t.trim().toLowerCase();
    return term !== "" && lower.includes(term);
  });
}

export function isWhereabouts(text: string): boolean {
  const t = norm(text).replace(MARKET_TERMS, " ");
  return LOCATION_RES.some((re) => re.test(t)) || ADDRESS.test(t) || ZIP.test(t);
}

export function preRules(c: InboundComment, blocklist: string[] = [], opts: PreRuleOptions = {}): RuleHit | null {
  if (c.isOwn) return { bucket: "flag", reason: "own comment" };
  const raw = c.text;
  const hide = HIDE.filter(([re]) => re.test(raw)).map(([, why]) => why);
  if (hide.length) return { bucket: "hide_flag", reason: [...new Set(hide)].join(", ") };

  const text = norm(raw).replace(MARKET_TERMS, " ");
  const promo = opts.skipPromo ? null : promoRule(raw, c, opts.promoAccounts ?? []);
  const whereabouts = isWhereabouts(raw);
  const blocked = hitsBlocklist(text, blocklist);
  const reasons: string[] = [];
  if (isQuestion(text) && !isRhetoricalPraise(text)) reasons.push("question");
  if (LINK.test(text)) reasons.push("link");
  if (whereabouts) reasons.push("location/schedule");
  if (BUSINESS.test(text)) reasons.push("brand/business");
  if (blocked) reasons.push("blocklist");
  // Whereabouts and private terms must reach the creator, even inside a promo comment.
  if (whereabouts || blocked) return { bucket: "flag", reason: [...reasons, ...(promo ? [promo.reason] : [])].join(", ") };
  if (promo) return promo;
  return reasons.length ? { bucket: "flag", reason: reasons.join(", ") } : null;
}

/** Words, not counting pure-emoji tokens. */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w && /[\p{L}\p{N}]/u.test(w)).length;
}

export function postRules(r: TriageResult, c: InboundComment, blocklist: string[] = [], opts: PostRuleOptions = {}): TriageResult {
  if (r.bucket === "spam_promo") {
    // The model may add promo (never reply), but not after the creator said "Not spam".
    if (opts.allowPromo === false) return { ...r, bucket: "flag", reply: null, reasons: [...r.reasons, "not spam (creator): review"] };
    return r.reply === null ? r : { ...r, reply: null };
  }
  if (r.bucket === "flag" || r.bucket === "hide_flag") return r;
  const toFlag = (reasons: string[]): TriageResult => ({ ...r, bucket: "flag", reasons: [...r.reasons, ...reasons] });
  if (r.reply === null || r.reply.trim() === "") return toFlag(["no draft"]);

  const reply = r.reply;
  const reasons: string[] = [];
  if (r.refused) reasons.push("model refused");
  // A question-shaped comment only ever gets a thank-you (rhetorical praise), never the negative pool.
  if (r.bucket === "negative" && isQuestion(c.text)) reasons.push("negative reply to a question");
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
