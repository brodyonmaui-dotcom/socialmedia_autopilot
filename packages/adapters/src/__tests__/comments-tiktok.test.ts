import { NonRetryableError } from "@autopilot/core";
import { describe, expect, it } from "vitest";
import { PlatformRequestError } from "../http.js";
import { createTikTokCommentSource, parseTikTokCommentKey, tiktokCommentKey, TIKTOK_NOT_CONNECTED } from "../comments/tiktok.js";
import { fixture, hasLocationKey, json, router, type Route } from "./helpers.js";

const BASE = "https://zernio.com/api/v1";
const POST = "7301000000000000001";
const cfgBase = { apiKey: "sk_fake_zernio", accountId: "acct_tt_fake" };
const listRoute: Route = [(u, i) => (i?.method ?? "GET") === "GET" && u === `${BASE}/inbox/comments?platform=tiktok&accountId=acct_tt_fake&limit=10&view=summary`, () => json(fixture("zernio-tt-commented-posts"))];
const threadRoute: Route = [(u, i) => (i?.method ?? "GET") === "GET" && u.startsWith(`${BASE}/inbox/comments/${POST}?accountId=acct_tt_fake&limit=50`), () => json(fixture("zernio-tt-post-comments"))];
const replyRoute: Route = [(u, i) => i?.method === "POST" && u === `${BASE}/inbox/comments/${POST}`, () => json(fixture("zernio-tt-reply-ok"))];

describe("createTikTokCommentSource (stub, no Zernio keys)", () => {
  it("fetchRecent returns nothing and keeps the cursor (a poll never errors)", async () => {
    await expect(createTikTokCommentSource().fetchRecent({ since: "x" })).resolves.toEqual({ comments: [], cursor: { since: "x" } });
  });
  it("has no reply/hide (the send tick shows what's missing instead of holding silently); fetchThread refuses", async () => {
    const src = createTikTokCommentSource();
    expect(src.reply).toBeUndefined();
    expect(src.hide).toBeUndefined();
    expect(src.placeholder).toBe(true);
    expect(src.replyUnavailableReason).toBe(TIKTOK_NOT_CONNECTED);
    expect(TIKTOK_NOT_CONNECTED).toMatch(/ZERNIO_API_KEY and ZERNIO_TIKTOK_ACCOUNT_ID/);
    await expect(src.fetchThread("c1")).rejects.toBeInstanceOf(NonRetryableError);
    await expect(src.fetchThread("c1")).rejects.toThrow(/tiktok comments disabled: no Zernio credentials/);
  });
});

describe("createTikTokCommentSource (Zernio Comments API)", () => {
  it("comment keys carry the post id", () => {
    expect(tiktokCommentKey("1", "2")).toBe("1:2");
    expect(parseTikTokCommentKey("1:2:3")).toEqual({ postId: "1", topId: "2", replyId: "3" });
    expect(parseTikTokCommentKey("bare")).toBeNull();
  });

  it("fetchRecent: posts → threads; top comments + nested replies; own by from.isOwner; hidden skipped; posts without comments not read", async () => {
    const r = router([listRoute, threadRoute]);
    const { comments, cursor } = await createTikTokCommentSource({ ...cfgBase, fetch: r.fetch }).fetchRecent(undefined);
    expect(comments.map((c) => c.platformCommentId)).toEqual([
      `${POST}:7302000000000000011`,
      `${POST}:7302000000000000011:7302000000000000012`,
      `${POST}:7302000000000000021`,
    ]);
    const [top, own, question] = comments;
    expect(top).toMatchObject({ platform: "tiktok", platformMediaId: POST, authorId: "tt_user_1", authorHandle: "fan_one", text: "this is fire 🔥", isOwn: false, createdAt: "2026-11-22T10:00:00.000Z" });
    expect(top!.ownRepliesInThread).toEqual([{ platformCommentId: "7302000000000000012", text: "appreciate you", createdAt: "2026-11-22T10:30:00.000Z" }]);
    expect(own).toMatchObject({ isOwn: true, parentId: `${POST}:7302000000000000011` });
    expect(question).toMatchObject({ text: "how many sets?", ownRepliesInThread: [] });
    expect(cursor).toEqual({ since: "2026-11-22T10:30:00.000Z" });
    // GET only, bearer auth, key never in a URL; the second post (commentCount 0) is never read.
    expect(r.calls).toHaveLength(2);
    expect(r.calls.every((c) => c.method === "GET" && c.headers.authorization === "Bearer sk_fake_zernio" && !c.url.includes("sk_fake"))).toBe(true);
  });

  it("cursor keeps a 15-minute overlap for Zernio's cache lag (dedupe is the DB's job)", async () => {
    const r = router([listRoute, threadRoute]);
    const src = createTikTokCommentSource({ ...cfgBase, fetch: r.fetch });
    const late = await src.fetchRecent({ since: "2026-11-22T10:40:00.000Z" });
    expect(late.comments.map((c) => c.platformCommentId)).toEqual([`${POST}:7302000000000000011:7302000000000000012`]);
    const none = await src.fetchRecent({ since: "2026-11-22T11:00:00.000Z" });
    expect(none.comments).toEqual([]);
    expect(none.cursor).toEqual({ since: "2026-11-22T11:00:00.000Z" });
  });

  it("400 PLATFORM_LIMITATION → source unavailable: one log line, empty polls, no more calls", async () => {
    const lines: string[] = [];
    const r = router([[(u) => u.startsWith(`${BASE}/inbox/comments?`), () => json(fixture("zernio-tt-platform-limitation"), 400)]]);
    const src = createTikTokCommentSource({ ...cfgBase, fetch: r.fetch, log: (l) => lines.push(l) });
    expect(await src.fetchRecent({ since: "x" })).toEqual({ comments: [], cursor: { since: "x" } });
    expect(await src.fetchRecent({ since: "x" })).toEqual({ comments: [], cursor: { since: "x" } });
    expect(lines).toEqual(["[engage] tiktok comments: source unavailable (PLATFORM_LIMITATION); connect TikTok through the Business app in Zernio"]);
    expect(r.calls).toHaveLength(1);
  });

  it("a developer-app account under meta.accountsSkipped is unavailable too", async () => {
    const lines: string[] = [];
    const r = router([[(u) => u.startsWith(`${BASE}/inbox/comments?`), () => json({ data: [], meta: { accountsSkipped: ["acct_tt_fake"] } })]]);
    const src = createTikTokCommentSource({ ...cfgBase, fetch: r.fetch, log: (l) => lines.push(l) });
    expect((await src.fetchRecent(undefined)).comments).toEqual([]);
    expect(lines).toHaveLength(1);
  });

  it("429 is retryable (PlatformRequestError), other 4xx are not; the key never appears in errors", async () => {
    const rate = router([[() => true, () => json({ error: "rate limited sk_fake_zernio" }, 429, { "retry-after": "30" })]]);
    const err = await createTikTokCommentSource({ ...cfgBase, fetch: rate.fetch }).fetchRecent(undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlatformRequestError);
    expect(String((err as Error).message)).not.toContain("sk_fake_zernio");
    const bad = router([[() => true, () => json({ error: "bad request" }, 400)]]);
    await expect(createTikTokCommentSource({ ...cfgBase, fetch: bad.fetch }).fetchRecent(undefined)).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("fetchThread finds a top comment or a nested reply; gone → null", async () => {
    const r = router([threadRoute]);
    const src = createTikTokCommentSource({ ...cfgBase, fetch: r.fetch });
    const top = await src.fetchThread(`${POST}:7302000000000000011`);
    expect(top!.ownRepliesInThread.map((x) => x.text)).toEqual(["appreciate you"]);
    expect((await src.fetchThread(`${POST}:7302000000000000011:7302000000000000012`))!.isOwn).toBe(true);
    expect(await src.fetchThread(`${POST}:999`)).toBeNull();
    expect(await src.fetchThread("not-a-key")).toBeNull();
  });

  it("fetchThread reads the full reply list when the inline replies are cut", async () => {
    const body = fixture("zernio-tt-post-comments");
    body.comments[0].replyCount = 5;
    body.comments[0].repliesHasMore = true;
    const r = router([
      [(u) => u.includes("&commentId=7302000000000000011"), () => json({ comments: [{ id: "r9", message: "Thanks man", createdTime: "2026-11-22T11:00:00Z", from: { id: "tt_creator", isOwner: true } }], pagination: { hasMore: false } })],
      [(u) => u.startsWith(`${BASE}/inbox/comments/${POST}?`), () => json(body)],
    ]);
    const top = await createTikTokCommentSource({ ...cfgBase, fetch: r.fetch }).fetchThread(`${POST}:7302000000000000011`);
    expect(top!.ownRepliesInThread.map((x) => x.text)).toEqual(["Thanks man"]);
  });

  it("reply: POST {accountId, commentId: the top comment, message} with the action's Idempotency-Key; no hide", async () => {
    const r = router([replyRoute]);
    const src = createTikTokCommentSource({ ...cfgBase, fetch: r.fetch });
    expect(src.hide).toBeUndefined();
    const res = await src.reply!(`${POST}:7302000000000000011:7302000000000000012`, "Appreciate you man", { idempotencyKey: "act-123" });
    expect(res).toEqual({ platformReplyId: `${POST}:7302000000000000011:7302000000000000099` });
    const call = r.calls[0]!;
    expect(call.json).toEqual({ accountId: "acct_tt_fake", commentId: "7302000000000000011", message: "Appreciate you man" });
    expect(call.headers["idempotency-key"]).toBe("act-123");
    expect(call.headers.authorization).toBe("Bearer sk_fake_zernio");
    expect(hasLocationKey(call.json)).toBe(false);
  });

  it("reply without a comment id in the response is an error (the send tick checks the thread before any retry)", async () => {
    const r = router([[() => true, () => json({ success: false })]]);
    await expect(createTikTokCommentSource({ ...cfgBase, fetch: r.fetch }).reply!(`${POST}:1`, "hi there", { idempotencyKey: "k" })).rejects.toBeInstanceOf(PlatformRequestError);
  });

  it("reply: a 5xx after the POST was sent is unknown (TimeoutError-class, never resent): Zernio's Idempotency-Key on this endpoint isn't verified", async () => {
    for (const status of [500, 502, 503]) {
      const r = router([[() => true, () => json({ error: "upstream" }, status)]]);
      const err = await createTikTokCommentSource({ ...cfgBase, fetch: r.fetch }).reply!(`${POST}:1`, "hi there", { idempotencyKey: "k" }).catch((e) => e);
      expect(err.name).toBe("TimeoutError");
      expect(String(err.message)).not.toContain("sk_fake_zernio");
    }
  });

  it("reply: a network error after the POST is unknown too; 4xx stays a failure; 429 may retry", async () => {
    const net = await createTikTokCommentSource({ ...cfgBase, fetch: async () => { throw new TypeError("fetch failed"); } }).reply!(`${POST}:1`, "hi", { idempotencyKey: "k" }).catch((e) => e);
    expect(net.name).toBe("TimeoutError");
    const bad = router([[() => true, () => json({ error: "bad request" }, 400)]]);
    await expect(createTikTokCommentSource({ ...cfgBase, fetch: bad.fetch }).reply!(`${POST}:1`, "hi", { idempotencyKey: "k" })).rejects.toBeInstanceOf(NonRetryableError);
    const busy = router([[() => true, () => json({ error: "rate limited" }, 429)]]);
    const e429 = await createTikTokCommentSource({ ...cfgBase, fetch: busy.fetch }).reply!(`${POST}:1`, "hi", { idempotencyKey: "k" }).catch((e) => e);
    expect(e429).toBeInstanceOf(PlatformRequestError);
    expect(e429.name).not.toBe("TimeoutError");
  });

  it("ids (verified 2026-11-25, docs.zernio.com): the list row's `id` (the TikTok video id) is the postId for the thread read and the reply; accountId on both", async () => {
    const list = fixture("zernio-tt-commented-posts");
    expect(list.data[0].id).toBe(POST); // numeric TikTok video id, no separate platformPostId in the list
    expect(Object.keys(list.data[0])).not.toContain("platformPostId");
    const r = router([listRoute, threadRoute, replyRoute]);
    const src = createTikTokCommentSource({ ...cfgBase, fetch: r.fetch });
    const { comments } = await src.fetchRecent(undefined);
    const q = comments.find((c) => c.text === "how many sets?")!;
    expect(q.platformMediaId).toBe(POST);
    await src.fetchThread(q.platformCommentId);
    await src.reply!(q.platformCommentId, "👍", { idempotencyKey: "engage:k" });
    const gets = r.calls.filter((c) => c.method === "GET" && c.url.startsWith(`${BASE}/inbox/comments/`));
    expect(gets.length).toBeGreaterThan(0);
    expect(gets.every((c) => c.url.startsWith(`${BASE}/inbox/comments/${POST}?accountId=acct_tt_fake&`))).toBe(true);
    const post = r.calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe(`${BASE}/inbox/comments/${POST}`);
    expect(post.json).toEqual({ accountId: "acct_tt_fake", commentId: "7302000000000000021", message: "👍" });
    expect(post.headers["idempotency-key"]).toBe("engage:k");
  });
});
