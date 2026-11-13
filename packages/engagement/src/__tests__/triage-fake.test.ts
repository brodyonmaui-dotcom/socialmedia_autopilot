import { describe, expect, it } from "vitest";
import { DEFAULT_FAKE_RULES, createFakeTriageClient } from "../triage-fake.js";
import type { InboundComment } from "../types.js";

const c = (text: string): InboundComment => ({
  platform: "youtube",
  platformCommentId: "c",
  platformMediaId: "m",
  authorId: null,
  text,
  createdAt: "2026-11-13T00:00:00.000Z",
  isOwn: false,
  ownRepliesInThread: [],
});

describe("createFakeTriageClient", () => {
  const t = createFakeTriageClient();
  it.each([
    ["this is fire 🔥", "simple_positive", "Appreciate you man"],
    ["clean form", "simple_positive", "Appreciate you man"],
    ["paid actor lol", "negative", "Have a great day 😊👍"],
    ["so cringe", "negative", "Have a great day 😊👍"],
    ["kys", "hide_flag", null],
    ["I know where you live", "hide_flag", null],
    ["what shoes?", "flag", null],
    ["collab with my brand", "flag", null],
  ] as const)("%s → %s", async (text, bucket, reply) => {
    const r = await t.triage(c(text), {});
    expect(r).toMatchObject({ bucket, reply, confidence: 0.9, model: "fake" });
  });

  it("default → flag 0.5", async () => {
    expect(await t.triage(c("ok"), {})).toMatchObject({ bucket: "flag", reply: null, confidence: 0.5, model: "fake" });
  });

  it("unsafe signals beat praise in the defaults", async () => {
    expect((await t.triage(c("nice pace, where is this trail?"), {})).bucket).toBe("flag");
    expect((await t.triage(c("love it, kys"), {})).bucket).toBe("hide_flag");
    expect(DEFAULT_FAKE_RULES).toHaveLength(4);
  });

  it("custom rules, first match wins, confidence override", async () => {
    const custom = createFakeTriageClient([
      [/a/, "negative", "first", 0.3],
      [/a/, "simple_positive", "second"],
      [/b/, "simple_positive", "bee"],
    ]);
    expect(await custom.triage(c("ab"), {})).toMatchObject({ bucket: "negative", reply: "first", confidence: 0.3 });
    expect(await custom.triage(c("b"), {})).toMatchObject({ bucket: "simple_positive", reply: "bee", confidence: 0.9 });
    expect(await custom.triage(c("zzz"), {})).toMatchObject({ bucket: "flag", confidence: 0.5 });
  });
});
