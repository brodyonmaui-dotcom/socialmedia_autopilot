import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTikTokCommentSource } from "@autopilot/adapters";
import { DEFAULT_ENGAGEMENT, runSendTick, type CommentSource, type EngagementPlatform, type EngagementSettings } from "@autopilot/engagement";
import { MemoryEngagementStore } from "@autopilot/engagement/src/testing/fake-store.js";

/**
 * Audit #3, end to end: the real TikTok comment source (fake fetch) inside the real send tick. A 5xx or a network
 * error on the reply POST → unknown + one engagement-unknown alert, and the next tick never resends it.
 * A 400 is a failure; a 429 is a retry.
 */
const BASE = "https://zernio.com/api/v1";
const POST = "7301000000000000001";
const NOW = new Date("2026-11-13T12:00:00Z");
const LIVE: EngagementSettings = { ...DEFAULT_ENGAGEMENT, mode: { instagram: "live", youtube: "live", tiktok: "live" } };
const thread = readFileSync(new URL("../../../../packages/adapters/src/__tests__/fixtures/zernio-tt-post-comments.json", import.meta.url), "utf8");

function run(replyResponse: () => Response) {
  const posts: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? "GET") === "GET" && url.startsWith(`${BASE}/inbox/comments/${POST}?`)) return new Response(thread, { status: 200 });
    if (init?.method === "POST" && url === `${BASE}/inbox/comments/${POST}`) {
      posts.push(url);
      return replyResponse();
    }
    throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
  };
  const src = createTikTokCommentSource({ apiKey: "sk_fake_zernio", accountId: "acct_tt_fake", fetch: fetchImpl, log: () => {} });
  const store = new MemoryEngagementStore();
  store.addAction({ id: "a1", platform: "tiktok", platformCommentId: `${POST}:7302000000000000011`, notBefore: "2026-11-13T11:00:00Z", origin: "manual" }); // manual: the fixture thread already has an own reply (auto would step back)
  const sources = new Map<EngagementPlatform, CommentSource>([["tiktok", src]]);
  const lines: string[] = [];
  const tick = (at: Date) => runSendTick(store, sources, { settings: LIVE, dryRun: false, killEnv: false, now: () => at, log: (l) => lines.push(l), timeoutMs: 1_000 });
  return { store, posts, tick };
}

describe("TikTok reply: 5xx / network after the POST → unknown, never resent", () => {
  for (const [label, resp] of [
    ["HTTP 503", () => new Response(JSON.stringify({ error: "upstream" }), { status: 503 })],
    ["network error", () => { throw new TypeError("fetch failed"); }],
  ] as Array<[string, () => Response]>) {
    it(label, async () => {
      const { store, posts, tick } = run(resp);
      const r = await tick(NOW);
      expect(r.unknown).toBe(1);
      expect(r.alerts.map((a) => a.kind)).toEqual(["engagement-unknown"]);
      expect(store.get("a1").status).toBe("unknown");
      const r2 = await tick(new Date(NOW.getTime() + 3 * 3_600_000));
      expect(r2.considered).toBe(0);
      expect(posts).toHaveLength(1);
    });
  }

  it("HTTP 400 → failed; HTTP 429 → retry", async () => {
    const bad = run(() => new Response(JSON.stringify({ error: "bad" }), { status: 400 }));
    expect((await bad.tick(NOW)).failed).toBe(1);
    expect(bad.store.get("a1").status).toBe("failed");
    const busy = run(() => new Response(JSON.stringify({ error: "slow down" }), { status: 429 }));
    expect((await busy.tick(NOW)).retried).toBe(1);
  });
});
