// Rules-only triage (F20 B): what the worker uses without ANTHROPIC_API_KEY. It runs after preRules (which
// already flags questions, links, whereabouts, business, blocklist, threats and promo), so it only decides
// "simple enough for a pool thank-you" vs "the creator should look". Its drafts carry model RULES_ONLY_MODEL:
// the triage job always stores them as 'shadow' (a draft in the Inbox), even when the platform is live, so
// nothing written by this client is ever sent without the creator's Approve.
import { POSITIVE_POOL } from "./pools.js";
import { isQuestion } from "./rules.js";
import type { TriageClient, TriageResult } from "./types.js";

export const RULES_ONLY_MODEL = "rules-only";

/** Longer comments usually say something specific; they go to the creator. */
export const RULES_ONLY_MAX_WORDS = 12;
export const RULES_ONLY_MAX_CHARS = 120;

/** Mockery / hate (same words as the fake triage's negative rule, plus a few common ones). */
export const NEGATIVE_WORDS =
  /fake|scam|paid actor|cringe|lol no|terrible|nobody asked|overrated|\b(?:trash|garbage|worst|awful|ugly|stupid|dumb|boring|lame|mid|clickbait|unfollow(?:ed|ing)?|sucks?|hate|wtf|stfu|shut up|bad|wrong|lies|liar|fraud|bs|ratio|l)\b|\bnot\s+(?:good|great|impressed|nice|worth|clean|real|true|funny)\b|👎|🤮|🤡|💩|🙄/i;
/** Sensitive topics: no canned thank-you, ever. */
export const SENSITIVE_WORDS =
  /\b(?:rip|died|dead|death|passed away|funeral|grief|depress(?:ed|ion)?|anxiety|suicid\w*|self[-\s]?harm|cancer|hospital|injur(?:y|ed|ies)|hurt|pain|sick of|politic\w*|religio\w*|racis\w*|sexis\w*)\b/i;

const words = (text: string) => text.trim().split(/\s+/).filter((w) => w && /[\p{L}\p{N}]/u.test(w)).length;

const flag = (why: string): TriageResult => ({ bucket: "flag", reply: null, confidence: 1, reasons: [`rules-only: ${why}`], model: RULES_ONLY_MODEL });

/** Deterministic, no network. The reply is a pool seed; the planner rotates over the settings pool as usual. */
export function createRulesOnlyTriageClient(): TriageClient {
  return {
    async triage(c) {
      const text = c.text.trim();
      if (text === "") return flag("empty");
      if (text.includes("?") || isQuestion(text)) return flag("question");
      if (NEGATIVE_WORDS.test(text)) return flag("negative");
      if (SENSITIVE_WORDS.test(text)) return flag("sensitive");
      if (text.length > RULES_ONLY_MAX_CHARS || words(text) > RULES_ONLY_MAX_WORDS) return flag("long comment");
      return { bucket: "simple_positive", reply: POSITIVE_POOL[0]!, confidence: 0.8, reasons: ["rules-only: short, simple"], model: RULES_ONLY_MODEL };
    },
  };
}
