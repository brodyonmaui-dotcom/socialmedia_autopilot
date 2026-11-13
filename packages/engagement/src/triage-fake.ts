// Deterministic triage for tests, simulate-week and dev without a key. First matching rule wins.
import type { Bucket, TriageClient } from "./types.js";

/** pattern, bucket, reply, confidence (default 0.9) */
export type FakeRule = [RegExp, Bucket, string | null, number?];

export const DEFAULT_FAKE_RULES: FakeRule[] = [
  [/kys|kill yourself|know where you live/i, "hide_flag", null],
  [/fake|scam|paid actor|cringe|lol no/i, "negative", "Have a great day 😊👍"],
  [/\?|collab|where|when|brand|dm/i, "flag", null],
  [/thank|love|fire|🔥|great|nice|clean/i, "simple_positive", "Appreciate you man"],
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
