import { NonRetryableError } from "@autopilot/core";
import { describe, expect, it } from "vitest";
import { createInstagramCommentSource } from "../comments/instagram.js";
import { fixture, hasLocationKey, json, router, type Route } from "./helpers.js";

const TOKEN = "EAAB-secret";
const cfg = { accessToken: TOKEN, igUserId: "1784" };
const isGet = (i?: RequestInit) => (i?.method ?? "GET") === "GET";
const mediaList = (u: string, i?: RequestInit) => isGet(i) && /\/1784\/media\?fields=id,caption,timestamp&limit=25$/.test(u);
const commentsOf = (u: string, i?: RequestInit) => isGet(i) && /\/18000000000000001\/comments\?fields=/.test(u);
const readRoutes: Route[] = [
  [mediaList, () => json({ data: [{ id: "18000000000000001", caption: "pull day", timestamp: "2026-11-11T07:00:00+0000" }] })],
  [commentsOf, () => json(fixture("ig-comments-list"))],
];

describe("createInstagramCommentSource", () => {
  it("fetchRecent flattens top-level comments + nested replies", async () => {
    const r = router(readRoutes);
    const { comments, cursor } = await createInstagramCommentSource({ ...cfg, fetch: r.fetch }).fetchRecent(undefined);
    expect(comments.map((c) => c.platformCommentId)).toEqual(["17890000000000003", "17890000000000001", "17890000000000011", "17890000000000012", "17890000000000002"]);
    expect(comments.every((c) => c.platform === "instagram" && c.platformMediaId === "18000000000000001")).toBe(true);
    const reply = comments.find((c) => c.platformCommentId === "17890000000000012")!;
    expect(reply.parentId).toBe("17890000000000001");
    expect(reply.authorId).toBe("9002");
    expect(reply.createdAt).toBe("2026-11-12T11:00:00.000Z");
    expect(cursor).toEqual({ since: "2026-11-12T12:30:00.000Z" });
    expect(r.calls[1]!.url).toContain("limit=50");
    expect(r.calls[1]!.url).toContain("replies{id,text,timestamp,from{id,username},username}");
    expect(r.calls.every((c) => c.headers.authorization === `Bearer ${TOKEN}` && !c.url.includes(TOKEN))).toBe(true);
  });

  it("authorId is null when `from` is missing (Development mode); handle falls back to username", async () => {
    const r = router(readRoutes);
    const { comments } = await createInstagramCommentSource({ ...cfg, fetch: r.fetch }).fetchRecent(undefined);
    const anon = comments.find((c) => c.platformCommentId === "17890000000000003")!;
    expect(anon.authorId).toBeNull();
    expect(anon.authorHandle).toBe("liftfan_99");
    expect(anon.isOwn).toBe(false);
  });

  it("isOwn by IG_USER_ID; ownRepliesInThread on the top-level comment we replied to (and siblings for a reply)", async () => {
    const r = router(readRoutes);
    const { comments } = await createInstagramCommentSource({ ...cfg, fetch: r.fetch }).fetchRecent(undefined);
    const byId = new Map(comments.map((c) => [c.platformCommentId, c]));
    expect(byId.get("17890000000000011")!.isOwn).toBe(true);
    expect(byId.get("17890000000000001")!.isOwn).toBe(false);
    expect(byId.get("17890000000000001")!.ownRepliesInThread).toEqual([{ platformCommentId: "17890000000000011", text: "haha it was", createdAt: "2026-11-12T10:20:00.000Z" }]);
    expect(byId.get("17890000000000012")!.ownRepliesInThread.map((x) => x.platformCommentId)).toEqual(["17890000000000011"]);
    expect(byId.get("17890000000000011")!.ownRepliesInThread).toEqual([]);
    expect(byId.get("17890000000000002")!.ownRepliesInThread).toEqual([]);
  });

  it("the cursor drops already-seen comments and only moves forward", async () => {
    const r = router(readRoutes);
    const src = createInstagramCommentSource({ ...cfg, fetch: r.fetch });
    const { comments, cursor } = await src.fetchRecent({ since: "2026-11-12T10:30:00.000Z" });
    expect(comments.map((c) => c.platformCommentId)).toEqual(["17890000000000003", "17890000000000012"]);
    expect(cursor).toEqual({ since: "2026-11-12T12:30:00.000Z" });
    const again = await src.fetchRecent({ since: "2026-11-13T00:00:00.000Z" });
    expect(again.comments).toEqual([]);
    expect(again.cursor).toEqual({ since: "2026-11-13T00:00:00.000Z" });
  });

  it("fetchRecent and fetchThread never POST", async () => {
    const r = router([
      [(_u, i) => !isGet(i), () => {
        throw new Error("POST during a read");
      }],
      ...readRoutes,
      [(u, i) => isGet(i) && /\/17890000000000012\?fields=id,text,timestamp,parent_id/.test(u), () => json({ id: "17890000000000012", text: "same here", timestamp: "2026-11-12T11:00:00+0000", parent_id: "17890000000000001", from: { id: "9002", username: "gymbuddy_b" }, media: { id: "18000000000000001" } })],
      [(u, i) => isGet(i) && /\/17890000000000001\/replies\?fields=/.test(u), () => json(fixture("ig-comment-replies"))],
    ]);
    const src = createInstagramCommentSource({ ...cfg, fetch: r.fetch });
    await src.fetchRecent(undefined);
    await src.fetchThread("17890000000000012");
    expect(r.calls.length).toBeGreaterThan(0);
    expect(r.calls.map((c) => c.method).every((m) => m === "GET")).toBe(true);
  });

  it("fetchThread fills ownRepliesInThread from the parent's replies; a deleted comment → null", async () => {
    const r = router([
      [(u) => /\/17890000000000001\?fields=/.test(u), () => json({ id: "17890000000000001", text: "this pull day looks brutal", timestamp: "2026-11-12T10:00:00+0000", from: { id: "9001", username: "gymbuddy_a" }, media: { id: "18000000000000001" } })],
      [(u) => /\/17890000000000001\/replies\?fields=/.test(u), () => json(fixture("ig-comment-replies"))],
      [(u) => /\/gone1\?fields=/.test(u), () => json({ error: { message: "Unsupported get request. Object with ID 'gone1' does not exist", code: 100, error_subcode: 33 } }, 400)],
    ]);
    const src = createInstagramCommentSource({ ...cfg, fetch: r.fetch });
    const c = (await src.fetchThread("17890000000000001"))!;
    expect(c.platformMediaId).toBe("18000000000000001");
    expect(c.parentId).toBeUndefined();
    expect(c.ownRepliesInThread.map((x) => x.platformCommentId)).toEqual(["17890000000000011"]);
    expect(await src.fetchThread("gone1")).toBeNull();
  });

  it("reply POSTs a form body with only `message` to a top-level comment", async () => {
    const r = router([
      [(u) => /\/17890000000000001\?fields=id,parent_id$/.test(u), () => json({ id: "17890000000000001" })],
      [(u, i) => i?.method === "POST" && u.endsWith("/17890000000000001/replies"), () => json(fixture("ig-comment-reply-ok"))],
    ]);
    const res = await createInstagramCommentSource({ ...cfg, fetch: r.fetch }).reply!("17890000000000001", "appreciate it 🙏", { idempotencyKey: "k1" });
    expect(res).toEqual({ platformReplyId: "17890000000000099" });
    const post = r.calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("https://graph.facebook.com/v25.0/17890000000000001/replies");
    expect(post.form).toEqual({ message: "appreciate it 🙏" });
    expect(post.url).not.toContain("message");
    expect(hasLocationKey(post.form)).toBe(false);
  });

  it("reply to a reply targets its parent (IG replies are top-level only)", async () => {
    const r = router([
      [(u) => /\/17890000000000012\?fields=id,parent_id$/.test(u), () => json({ id: "17890000000000012", parent_id: "17890000000000001" })],
      [(u, i) => i?.method === "POST" && u.endsWith("/17890000000000001/replies"), () => json(fixture("ig-comment-reply-ok"))],
    ]);
    await createInstagramCommentSource({ ...cfg, fetch: r.fetch }).reply!("17890000000000012", "thanks", { idempotencyKey: "k2" });
    expect(r.calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["https://graph.facebook.com/v25.0/17890000000000001/replies"]);
  });

  it("hide POSTs hide=true as a form", async () => {
    const r = router([[(u, i) => i?.method === "POST" && u.endsWith("/17890000000000003"), () => json(fixture("ig-comment-hide-ok"))]]);
    await createInstagramCommentSource({ ...cfg, fetch: r.fetch }).hide!("17890000000000003");
    expect(r.calls[0]!.form).toEqual({ hide: "true" });
    expect(r.calls[0]!.url).toBe("https://graph.facebook.com/v25.0/17890000000000003");
  });

  it("a (#200) permission error → NonRetryableError with the token redacted", async () => {
    const r = router([
      [(u) => /\?fields=id,parent_id$/.test(u), () => json({ id: "17890000000000001" })],
      [(_u, i) => i?.method === "POST", () => json({ error: { message: `(#200) Requires instagram_manage_comments permission (token ${TOKEN}, access_token=${TOKEN})`, type: "OAuthException", code: 200 } }, 403)],
    ]);
    const err = await createInstagramCommentSource({ ...cfg, fetch: r.fetch }).reply!("17890000000000001", "hi", { idempotencyKey: "k3" }).then(() => new Error("expected a rejection"), (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(err.message).toContain("(#200)");
    expect(err.message).not.toContain(TOKEN);
  });

  it("other errors are a PlatformRequestError, token redacted from message and body", async () => {
    const r = router([[mediaList, () => json({ error: { message: `An unexpected error has occurred (${TOKEN})`, code: 2 } }, 500)]]);
    const err = await createInstagramCommentSource({ ...cfg, fetch: r.fetch }).fetchRecent(undefined).then(() => null, (e: unknown) => e as Error & { body: unknown });
    if (!err) throw new Error("expected a rejection");
    expect(err.name).toBe("PlatformRequestError");
    expect(err.message).not.toContain(TOKEN);
    expect(JSON.stringify(err.body)).not.toContain(TOKEN);
  });
});
