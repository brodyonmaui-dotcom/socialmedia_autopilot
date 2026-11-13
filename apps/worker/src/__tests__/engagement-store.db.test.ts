// Runs against a real Postgres with migrations 0001-0007 (DATABASE_URL). Rows are created under
// platform 'youtube' with platform_comment_id prefixed `test-` and a unique run id, and left in place.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { DEFAULT_ENGAGEMENT, type InboundComment } from "@autopilot/engagement";
import { getSetting, setSetting } from "@autopilot/db";
import { PgEngagementStore } from "../jobs/engagement-store.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("PgEngagementStore (db)", () => {
  let pool: pg.Pool;
  let store: PgEngagementStore;
  const run = randomUUID().slice(0, 8);
  const author = `test-author-${run}`;
  const now = new Date();
  const comment = (n: string, p: Partial<InboundComment> = {}): InboundComment => ({
    platform: "youtube",
    platformCommentId: `test-${run}-${n}`,
    platformMediaId: `test-vid-${run}`,
    authorId: author,
    authorHandle: "tester",
    text: `nice one ${n}`,
    createdAt: new Date(now.getTime() - 60_000).toISOString(),
    isOwn: false,
    ownRepliesInThread: [],
    ...p,
  });
  const idOf = async (n: string): Promise<string> =>
    (await pool.query("select id from comments where platform = 'youtube' and platform_comment_id = $1", [`test-${run}-${n}`])).rows[0].id;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
    store = new PgEngagementStore(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("upsert twice inserts once and stores own replies as is_own rows", async () => {
    const c = comment("a", { ownRepliesInThread: [{ platformCommentId: `test-${run}-a-own`, text: "Appreciate it", createdAt: now.toISOString() }] });
    expect(await store.upsertComments([c, comment("b")], now)).toBe(2);
    expect(await store.upsertComments([c, comment("b")], now)).toBe(0);
    const untriaged = (await store.listUntriaged(500)).filter((u) => u.comment.platformCommentId.startsWith(`test-${run}-`));
    expect(untriaged.map((u) => u.comment.platformCommentId).sort()).toEqual([`test-${run}-a`, `test-${run}-b`]);
    const a = untriaged.find((u) => u.comment.platformCommentId === `test-${run}-a`)!;
    expect(a.comment.ownRepliesInThread).toEqual([{ platformCommentId: `test-${run}-a-own`, text: "Appreciate it", createdAt: now.toISOString() }]);
    expect(a.ctx.pillar).toBeNull();
  });

  it("saveTriage removes the comment from listUntriaged", async () => {
    const id = await idOf("b");
    await store.saveTriage(id, { bucket: "flag", reply: null, confidence: 1, reasons: ["question"], model: "rules" }, now);
    const ids = (await store.listUntriaged(500)).map((u) => u.id);
    expect(ids).not.toContain(id);
  });

  it("insertAction once per (comment, kind); due list; claim is conditional; mark sent feeds limits and history", async () => {
    const id = await idOf("a");
    const nb = new Date(now.getTime() - 1000);
    expect(await store.insertAction(id, "reply", "Appreciate you man", "planned", nb, now)).toBe(true);
    expect(await store.insertAction(id, "reply", "other", "planned", nb, now)).toBe(false);
    const due = (await store.listDueActions(new Date(now.getTime() + 1000), 500)).find((r) => r.commentId === id)!;
    expect(due).toMatchObject({ platform: "youtube", platformCommentId: `test-${run}-a`, authorId: author, kind: "reply", status: "planned", attempts: 0, origin: "auto" });

    const before = await store.limitCounts("youtube", author, DEFAULT_ENGAGEMENT.limits, now);
    expect(await store.claimAction(due.id, now)).toBe(true);
    expect(await store.claimAction(due.id, now)).toBe(false);
    const during = await store.limitCounts("youtube", author, DEFAULT_ENGAGEMENT.limits, now);
    expect(during.platformHour).toBe(before.platformHour + 1);
    expect(during.platformDay).toBe(before.platformDay + 1);
    expect(during.globalDay).toBe(before.globalDay + 1);
    expect(during.authorWindow).toBe(1);

    await store.markSent(due.id, `test-${run}-reply`, now);
    const after = await store.limitCounts("youtube", author, DEFAULT_ENGAGEMENT.limits, now);
    expect(after.authorWindow).toBe(1);
    expect(await store.repliesToAuthorSince("youtube", author, new Date(now.getTime() - 3_600_000))).toEqual(["Appreciate you man"]);
    expect(await store.textUseCount("youtube", "Appreciate you man", new Date(now.getTime() - 1000))).toBeGreaterThanOrEqual(1);
    expect(await store.lastRepliesOn("youtube", 5)).toContain("Appreciate you man");
    expect((await store.recentOutcomes("youtube", 1))[0]).toEqual({ ok: true });
    const { rows } = await pool.query("select status, attempts, platform_action_id from engagement_actions where id = $1", [due.id]);
    expect(rows[0]).toEqual({ status: "sent", attempts: 1, platform_action_id: `test-${run}-reply` });
    expect(await store.isBlockedAuthor("youtube", author)).toBe(false);
  });

  it("markCancelled only cancels planned rows; listStaleSending finds old claims only", async () => {
    await store.upsertComments([comment("d"), comment("e")], now);
    const d = await idOf("d");
    const e = await idOf("e");
    const nb = new Date(now.getTime() - 1000);
    expect(await store.insertAction(d, "reply", "Thanks, means a lot", "planned", nb, now)).toBe(true);
    expect(await store.insertAction(e, "reply", "Glad you liked it", "planned", nb, now)).toBe(true);
    const due = await store.listDueActions(new Date(now.getTime() + 1000), 500);
    const rowD = due.find((r) => r.commentId === d)!;
    const rowE = due.find((r) => r.commentId === e)!;

    await store.markCancelled(rowD.id, "creator replied first", now);
    const { rows } = await pool.query("select status, last_error from engagement_actions where id = $1", [rowD.id]);
    expect(rows[0]).toEqual({ status: "cancelled", last_error: "creator replied first" });
    expect((await store.listDueActions(new Date(now.getTime() + 1000), 500)).some((r) => r.id === rowD.id)).toBe(false);

    const claimedAt = new Date(now.getTime() - 20 * 60_000);
    expect(await store.claimAction(rowE.id, claimedAt)).toBe(true);
    await store.markCancelled(rowE.id, "creator replied first", now); // not planned → no-op
    const stale = await store.listStaleSending(new Date(now.getTime() - 10 * 60_000), 500);
    expect(stale.find((r) => r.id === rowE.id)).toMatchObject({ status: "sending", commentId: e, platformCommentId: `test-${run}-e` });
    expect((await store.listStaleSending(new Date(now.getTime() - 30 * 60_000), 500)).some((r) => r.id === rowE.id)).toBe(false);
    await store.markUnknown(rowE.id, "crashed send: settled as unknown", now);
    expect((await store.listStaleSending(now, 500)).some((r) => r.id === rowE.id)).toBe(false);
  });

  it("shadow rows are never due", async () => {
    await store.upsertComments([comment("c")], now);
    const id = await idOf("c");
    expect(await store.insertAction(id, "reply", "Thanks, means a lot", "shadow", new Date(0), now)).toBe(true);
    expect((await store.listDueActions(new Date(now.getTime() + 1000), 500)).some((r) => r.commentId === id)).toBe(false);
  });

  it("recordAlert dedupes on kind + message prefix while unacknowledged", async () => {
    const msg = `test ${run}: reply failed: ${"x".repeat(90)}`;
    const alert = { kind: "engagement-failure" as const, platform: "youtube" as const, actionId: null, message: msg, at: now.toISOString() };
    expect(await store.recordAlert(alert)).toBe(true);
    expect(await store.recordAlert({ ...alert, message: `${msg.slice(0, 80)} different tail` })).toBe(false);
    expect(await store.recordAlert({ ...alert, message: `other ${msg}` })).toBe(true);
    await pool.query("update alerts set acknowledged_at = now() where message like $1", [`%test ${run}:%`]);
    expect(await store.recordAlert(alert)).toBe(true);
    await pool.query("update alerts set acknowledged_at = now() where message like $1 and acknowledged_at is null", [`%test ${run}:%`]);
  });

  it("setKilled round-trips through settings and keeps the overlay", async () => {
    const original = await getSetting<unknown>(pool, "engagement");
    try {
      await setSetting(pool, "engagement", { mode: { youtube: "shadow" } });
      await store.setKilled(`test ${run}`, now);
      const s = await store.loadSettings();
      expect(s.killed).toBe(true);
      expect(s.killedReason).toBe(`test ${run}`);
      expect(await getSetting(pool, "engagement")).toEqual({ mode: { youtube: "shadow" }, killed: true, killedReason: `test ${run}` });
    } finally {
      await setSetting(pool, "engagement", original ?? {});
    }
  });

  it("cursors round-trip (string and object)", async () => {
    const key = `test-${run}`;
    expect(await store.getCursor(key)).toBeNull();
    await store.setCursor(key, "abc", now);
    expect(await store.getCursor(key)).toEqual({ cursor: "abc", polledAt: now });
    await store.setCursor(key, { since: 5 }, now);
    expect((await store.getCursor(key))?.cursor).toEqual({ since: 5 });
  });

  it("DM threads upsert idempotently and drafts link to the message", async () => {
    const thread = { platformThreadId: `test-${run}-th`, participantId: `test-${run}-u`, messages: [{ id: `test-${run}-m1`, dir: "in" as const, text: "hi", at: now.toISOString() }] };
    const [a] = await store.upsertDmThreads([thread], "me", now);
    const [b] = await store.upsertDmThreads([thread], "me", now);
    expect(a!.threadId).toBe(b!.threadId);
    expect(await store.latestDraft(a!.threadId)).toBeNull();
    await store.insertDmDraft(a!.threadId, `test-${run}-m1`, "Thanks for the message, appreciate it.", "other");
    expect((await store.latestDraft(a!.threadId))?.forPlatformMessageId).toBe(`test-${run}-m1`);
    const { rows } = await pool.query("select last_inbound_at, last_outbound_at from dm_threads where id = $1", [a!.threadId]);
    expect(new Date(rows[0].last_inbound_at).toISOString()).toBe(now.toISOString());
    expect(rows[0].last_outbound_at).toBeNull();
  });
});
