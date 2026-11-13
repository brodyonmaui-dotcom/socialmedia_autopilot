import { describe, expect, it } from "vitest";
import { createYouTubeCommentSource } from "../comments/youtube.js";
import { fixture, hasLocationKey, json, router, type Route } from "./helpers.js";

const cfg = { clientId: "cid", clientSecret: "csecret", refreshToken: "rtok", channelId: "UCours" };
const tokenRoute: Route = [(u) => u === "https://oauth2.googleapis.com/token", () => json(fixture("yt-token"))];
const threadsRoute: Route = [(u) => u.includes("/youtube/v3/commentThreads?part=snippet,replies&allThreadsRelatedToChannelId=UCours&maxResults=50&order=time"), () => json(fixture("yt-comment-threads"))];
const lookup = (id: string, parentId?: string): Route => [
  (u) => u.endsWith(`/youtube/v3/comments?part=snippet&id=${encodeURIComponent(id)}`),
  () => json({ items: [{ id, snippet: { ...(parentId ? { parentId } : {}), textOriginal: "x", authorChannelId: { value: "UCviewer1" } } }] }),
];

describe("createYouTubeCommentSource", () => {
  it("parses threads + replies; isOwn by channel id; cursor = newest", async () => {
    const r = router([tokenRoute, threadsRoute]);
    const { comments, cursor } = await createYouTubeCommentSource({ ...cfg, fetch: r.fetch }).fetchRecent(undefined);
    expect(comments.map((c) => c.platformCommentId)).toEqual(["UgxThread1", "UgxThread1.reply1", "UgxThread2"]);
    const [top, reply, other] = comments;
    expect(top).toMatchObject({ platform: "youtube", platformMediaId: "vid111", authorId: "UCviewer1", authorHandle: "@viewerone", text: "great set!", isOwn: false });
    expect(top!.ownRepliesInThread).toEqual([{ platformCommentId: "UgxThread1.reply1", text: "thanks!", createdAt: "2026-11-12T09:30:00.000Z" }]);
    expect(reply).toMatchObject({ parentId: "UgxThread1", isOwn: true, authorId: "UCours" });
    expect(other).toMatchObject({ platformMediaId: "vid222", text: "how many reps?", ownRepliesInThread: [] });
    expect(cursor).toEqual({ since: "2026-11-12T09:30:00.000Z" });
    expect(r.calls.every((c) => c.method === "POST" ? c.url.includes("oauth2") : true)).toBe(true);
    const list = await createYouTubeCommentSource({ ...cfg, fetch: r.fetch }).fetchRecent({ since: "2026-11-12T00:00:00.000Z" });
    expect(list.comments.map((c) => c.platformCommentId)).toEqual(["UgxThread1", "UgxThread1.reply1"]);
  });

  it("authorId null when authorChannelId is missing", async () => {
    const body = fixture("yt-comment-threads");
    delete body.items[1].snippet.topLevelComment.snippet.authorChannelId;
    const r = router([tokenRoute, [(u) => u.includes("/commentThreads?"), () => json(body)]]);
    const { comments } = await createYouTubeCommentSource({ ...cfg, fetch: r.fetch }).fetchRecent(undefined);
    expect(comments.find((c) => c.platformCommentId === "UgxThread2")!.authorId).toBeNull();
  });

  it("defaults: reply and hide are undefined; capabilities false", () => {
    const src = createYouTubeCommentSource(cfg);
    expect(src.reply).toBeUndefined();
    expect(src.hide).toBeUndefined();
    expect(src.capabilities).toEqual({ reply: false, hide: false });
  });

  it("canReply: comments.insert with snippet.parentId (the thread) + textOriginal", async () => {
    const r = router([tokenRoute, lookup("UgxThread1.reply1", "UgxThread1"), [(u, i) => i?.method === "POST" && u === "https://www.googleapis.com/youtube/v3/comments?part=snippet", () => json(fixture("yt-comment-insert-ok"))]]);
    const src = createYouTubeCommentSource({ ...cfg, fetch: r.fetch, canReply: true });
    expect(src.capabilities.reply).toBe(true);
    const res = await src.reply!("UgxThread1.reply1", "appreciate it", { idempotencyKey: "k" });
    expect(res).toEqual({ platformReplyId: "UgxThread1.reply2" });
    const post = r.calls.find((c) => c.url.endsWith("/comments?part=snippet"))!;
    expect(post.json).toEqual({ snippet: { parentId: "UgxThread1", textOriginal: "appreciate it" } });
    expect(post.headers.authorization).toBe(`Bearer ${fixture("yt-token").access_token}`);
    expect(hasLocationKey(post.json)).toBe(false);
  });

  it("canModerate: setModerationStatus heldForReview (never rejected/ban)", async () => {
    const r = router([tokenRoute, [(u, i) => i?.method === "POST" && u.includes("/comments/setModerationStatus"), () => new Response(null, { status: 204 })]]);
    const src = createYouTubeCommentSource({ ...cfg, fetch: r.fetch, canModerate: true });
    expect(src.capabilities.hide).toBe(true);
    await src.hide!("UgxThread2");
    const post = r.calls.find((c) => c.url.includes("setModerationStatus"))!;
    expect(post.url).toBe("https://www.googleapis.com/youtube/v3/comments/setModerationStatus?id=UgxThread2&moderationStatus=heldForReview");
    expect(post.url).not.toMatch(/banAuthor|rejected/);
  });

  it("fetchThread: resolves the thread, reads full replies, never POSTs to the API; gone → null", async () => {
    const r = router([
      tokenRoute,
      lookup("UgxThread1"),
      [(u) => u.includes("/commentThreads?part=snippet,replies&id=UgxThread1"), () => json({ items: [fixture("yt-comment-threads").items[0]] })],
      [(u) => u.includes("/comments?part=snippet&parentId=UgxThread1"), () => json({ items: fixture("yt-comment-threads").items[0].replies.comments })],
      [(u) => u.includes("/comments?part=snippet&id=gone"), () => json({ items: [] })],
    ]);
    const src = createYouTubeCommentSource({ ...cfg, fetch: r.fetch });
    const c = (await src.fetchThread("UgxThread1"))!;
    expect(c.ownRepliesInThread.map((x) => x.platformCommentId)).toEqual(["UgxThread1.reply1"]);
    expect(await src.fetchThread("gone")).toBeNull();
    expect(r.calls.filter((x) => x.method === "POST").every((x) => x.url.includes("oauth2"))).toBe(true);
  });

  it("insufficientPermissions → NonRetryableError", async () => {
    const r = router([tokenRoute, lookup("UgxThread1"), [(_u, i) => i?.method === "POST", () => json({ error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } }, 403)]]);
    const src = createYouTubeCommentSource({ ...cfg, fetch: r.fetch, canReply: true });
    await expect(src.reply!("UgxThread1", "hi", { idempotencyKey: "k" })).rejects.toMatchObject({ name: "NonRetryableError" });
  });
});
