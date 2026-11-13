// F7 B6: the AI key and platform tokens never reach a log line, a TriageResult, a prompt or the store.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { NonRetryableError } from "@autopilot/core";
import { runSendTick, redactSecrets } from "../send.js";
import { DEFAULT_ENGAGEMENT } from "../settings.js";
import { createAnthropicTriageClient, type AnthropicTriageConfig } from "../triage-anthropic.js";
import { MemoryEngagementStore } from "../testing/fake-store.js";
import { FakeCommentSource } from "../testing/fake-source.js";
import type { CommentSource, EngagementPlatform, EngagementSettings, InboundComment } from "../types.js";

// Obviously fake values, shaped like the real things.
const API_KEY = "sk-ant-api03-FAKEfakeFAKEfake0123456789abcdefABCDEF-xyzXYZ";
const BEARER = "EAAGfakeTOKENfakeTOKEN0123456789abcdefZZZ";
const ACCESS = "IGQVfakeAccessToken0123456789abcdefQQQ";
const SECRETS = [API_KEY, BEARER, ACCESS, "FAKEfakeFAKEfake"];
const LEAKY = `401 invalid x-api-key ${API_KEY}; Authorization: Bearer ${BEARER}; GET https://graph.example/v1/me?access_token=${ACCESS}&fields=id`;

const contains = (s: string) => SECRETS.filter((x) => s.includes(x));

const comment: InboundComment = {
  platform: "instagram", platformCommentId: "c1", platformMediaId: "m1", authorId: "u1", authorHandle: "someone",
  text: "love this", createdAt: "2026-11-13T10:00:00.000Z", isOwn: false, ownRepliesInThread: [],
};

function throwingClient(err: unknown) {
  const params: unknown[] = [];
  const client = {
    messages: {
      parse: async (p: unknown) => {
        params.push(p);
        throw err;
      },
    },
  } as unknown as NonNullable<AnthropicTriageConfig["client"]>;
  return { client, params };
}

describe("B6: Anthropic triage client never leaks the key or tokens", () => {
  const errors: Array<[string, unknown]> = [
    ["plain Error", new Error(LEAKY)],
    ["APIError", new Anthropic.APIError(401, { type: "error", error: { type: "authentication_error", message: LEAKY } }, LEAKY, new Headers({ "x-api-key": API_KEY }))],
    ["TypeError (network)", new TypeError(LEAKY)],
    ["a thrown string", LEAKY],
  ];
  for (const [name, err] of errors) {
    it(`${name}: no log line, result field or prompt contains a secret`, async () => {
      const lines: string[] = [];
      const { client, params } = throwingClient(err);
      const r = await createAnthropicTriageClient({ apiKey: API_KEY, client, log: (l) => lines.push(l) }).triage(comment, { postCaption: "leg day" });
      expect(r.bucket).toBe("flag");
      expect(r.reply).toBeNull();
      expect(contains(JSON.stringify(r))).toEqual([]);
      expect(lines.length).toBeGreaterThan(0);
      expect(contains(lines.join("\n"))).toEqual([]);
      expect(contains(JSON.stringify(params))).toEqual([]); // the prompt never carries the key
    });
  }
});

describe("B6: send tick redacts secrets in errors before the store, alerts and logs", () => {
  const settings: EngagementSettings = { ...DEFAULT_ENGAGEMENT, mode: { instagram: "live", youtube: "live", tiktok: "off" } };
  const run = async (src: CommentSource) => {
    const store = new MemoryEngagementStore();
    store.addAction({ id: "a1", notBefore: "2026-11-13T11:00:00Z" });
    const lines: string[] = [];
    const sources = new Map<EngagementPlatform, CommentSource>([["instagram", src]]);
    const r = await runSendTick(store, sources, { settings, dryRun: false, killEnv: false, now: () => new Date("2026-11-13T12:00:00Z"), log: (l) => lines.push(l), timeoutMs: 20 });
    return { store, lines, r };
  };

  it("retryable rejection → last_error redacted", async () => {
    const { store, lines } = await run(new FakeCommentSource("instagram", { behaviours: { "pc-a1": "reject" }, rejectMessage: LEAKY, missingThread: "empty" }));
    const row = store.get("a1");
    expect(row.status).toBe("planned");
    expect(row.lastError).toContain("[redacted]");
    expect(contains(row.lastError!)).toEqual([]);
    expect(contains(lines.join("\n"))).toEqual([]);
    expect(contains(JSON.stringify(store.outcomes))).toEqual([]);
  });

  it("permanent failure → last_error and the alert message redacted", async () => {
    const src = new FakeCommentSource("instagram", { missingThread: "empty" });
    src.reply = async () => {
      throw new NonRetryableError(LEAKY);
    };
    const { store, lines, r } = await run(src);
    expect(store.get("a1").status).toBe("failed");
    expect(contains(store.get("a1").lastError!)).toEqual([]);
    expect(r.alerts).toHaveLength(1);
    expect(contains(JSON.stringify(store.alerts))).toEqual([]);
    expect(contains(lines.join("\n"))).toEqual([]);
  });

  it("a failed thread re-read (lookup error) logs nothing secret", async () => {
    const src = new FakeCommentSource("instagram");
    src.fetchThread = async () => {
      throw new Error(LEAKY);
    };
    const { lines, store } = await run(src);
    expect(store.get("a1").status).toBe("planned");
    expect(contains(lines.join("\n"))).toEqual([]);
  });

  it("redactSecrets keeps the useful part of the message", () => {
    const out = redactSecrets(LEAKY);
    expect(out).toContain("401 invalid x-api-key");
    expect(out).toContain("fields=id");
    expect(out).toContain("Bearer [redacted]");
    expect(out).toContain("access_token=[redacted]");
    expect(redactSecrets("comment 17895695668004550 not found")).toBe("comment 17895695668004550 not found");
  });
});
