// Deterministic triage for tests, simulate-week and dev without a key. First matching rule wins.
import type { Bucket, TriageClient } from "./types.js";

/** pattern, bucket, reply, confidence (default 0.9) */
export type FakeRule = [RegExp, Bucket, string | null, number?];

export const DEFAULT_FAKE_RULES: FakeRule[] = [
  [/kys|kill yourself|know where you live/i, "hide_flag", null],
  // A model may add promo on its own (never remove a rule's promo verdict).
  [/\bfeature (?:you|your)\b|promo(?:tion)? (?:offer|service)s?|followers? for sale/i, "spam_promo", null],
  [/fake|scam|paid actor|cringe|lol no|terrible|nobody asked|overrated/i, "negative", "Have a great day 😊👍"],
  // Rhetorical praise ("how are you this good?!", "bro what 🔥?"): the model is confident it's praise.
  [/(?:\?!|!\?)|^(?:bro )?what 🔥\?$/i, "simple_positive", "Appreciate you man", 0.8],
  [/\?|collab|where|when|sponsor|partnership|\bdm\b|brand deal/i, "flag", null],
  [/thank|love|fire|🔥|great|nice|clean|insane|crazy|goat|🐐|respect|underrated|inspir|motivat|best|legend|\bw\b|💪|🙌|👏|❤️|😎|👑|unreal|gold|easy|needed this|keep going|smooth|solid|hits? different|look at this|try this|combo|lift|disciplin|patien|consisten|progress/i, "simple_positive", "Appreciate you man"],
];

export function createFakeTriageClient(rules: FakeRule[] = DEFAULT_FAKE_RULES): TriageClient {
  return {
    async triage(c) {
      for (const [re, bucket, reply, confidence] of rules) {
        re.lastIndex = 0;
        if (re.test(c.text)) return { bucket, reply, confidence: confidence ?? 0.9, reasons: [`fake: ${re.source}`], model: "fake" };
      }
      return { bucket: "flag", reply: null, confidence: 0.5, reasons: ["fake: no rule matched"], model: "fake" };
    },
  };
}
