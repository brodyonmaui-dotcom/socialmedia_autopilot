import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgBatchStore } from "../pg-store.js";
import { ConflictError } from "../store.js";

/**
 * Runs against a real dev DB (DATABASE_URL). apply() opens its own transaction, so the test can't
 * roll back around it: it makes a throwaway batch far in the future (week 2099-01-05) and, at the
 * end, leaves its items rejected and the batch draft. Nothing is ever deleted.
 */
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("PgBatchStore (db)", () => {
  let pool: pg.Pool;
  let store: PgBatchStore;
  let batchId: string;
  let cleanMedia: { id: string; source_path: string | null };
  let rawMedia: { id: string };
  let a: string; // instagram, on cleanMedia
  let b: string; // youtube, on rawMedia
  let sessionId: string;
  const now = new Date("2026-11-13T12:00:00.000Z");
  const later = new Date("2026-11-13T12:05:00.000Z");

  const item = async (id: string) => (await pool.query("select * from batch_items where id = $1", [id])).rows[0];
  const events = async (id: string) => (await pool.query("select * from batch_item_events where batch_item_id = $1 order by id", [id])).rows;
  const batchRow = async () => (await pool.query("select * from batches where id = $1", [batchId])).rows[0];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 });
    store = new PgBatchStore(pool);
    const clean = (await pool.query("select id, source_path from media where r2_key is not null order by created_at limit 1")).rows[0];
    const raw = (await pool.query("select id from media where r2_key is null order by created_at limit 1")).rows[0];
    if (!clean || !raw) throw new Error("seed the dev DB first (pnpm dev:seed): need media with and without r2_key");
    cleanMedia = clean;
    rawMedia = raw;
    sessionId = (
      await pool.query(
        "insert into auth_sessions (token_hash, expires_at, hard_expires_at, revoked_at) values ($1, now() + interval '1 day', now() + interval '1 day', now()) returning id",
        [`test-${randomUUID()}`],
      )
    ).rows[0].id;
    batchId = (await pool.query("insert into batches (week_start, status) values ('2099-01-05', 'draft') returning id")).rows[0].id;
    const ins = (media: string, platform: string, at: string, title: string | null) =>
      pool.query(
        "insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, trial, status) values ($1, $2, $3, 'test caption', $4, $5, $6, 'draft') returning id",
        [batchId, media, platform, title, at, platform === "tiktok" ? JSON.stringify({ tiktokDraft: true }) : null],
      );
    a = (await ins(cleanMedia.id, "instagram", "2099-01-06T10:00:00Z", null)).rows[0].id;
    b = (await ins(rawMedia.id, "youtube", "2099-01-06T11:00:00Z", "Test title")).rows[0].id;
  });

  afterAll(async () => {
    if (batchId) {
      await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1", [batchId]);
      await pool.query("update batches set status = 'draft', approved_at = null where id = $1", [batchId]);
    }
    await pool?.end();
  });

  it("loadBatch maps media, hasCleanFile, flags and counts", async () => {
    const v = await store.loadBatch(batchId);
    expect(v).not.toBeNull();
    expect(v!.weekStart).toBe("2099-01-05");
    expect(v!.counts.draft).toBe(2);
    expect(v!.counts.approved).toBe(0);
    const ia = v!.items.find((i) => i.id === a)!;
    const ib = v!.items.find((i) => i.id === b)!;
    expect(ia).toMatchObject({ platform: "instagram", scheduledFor: "2099-01-06T10:00:00.000Z", editable: true, handedOff: false, warnings: [], tiktokDraft: false });
    expect(ia.media.hasCleanFile).toBe(true);
    expect(ib.media.hasCleanFile).toBe(false);
    expect(ib.title).toBe("Test title");
    const expected = cleanMedia.source_path?.split("/").pop()?.replace(/\.[^.]*$/, "") || cleanMedia.id.slice(0, 8);
    expect(ia.media.label).toBe(expected);
    expect(await store.loadBatch(randomUUID())).toBeNull();
  });

  it("apply approve stamps approved_at + approved_session, writes an event, approves the batch", async () => {
    await store.apply(batchId, [{ itemId: a, from: "draft", to: "approved", eventKind: "approve" }], "approved", sessionId, now);
    const r = await item(a);
    expect(r.status).toBe("approved");
    expect(r.approved_at.toISOString()).toBe(now.toISOString());
    expect(r.approved_session).toBe(sessionId);
    const ev = await events(a);
    expect(ev.at(-1)).toMatchObject({ kind: "approve", from_status: "draft", to_status: "approved", detail: null, session_id: sessionId });
    const br = await batchRow();
    expect(br.status).toBe("approved");
    expect(br.approved_at.toISOString()).toBe(now.toISOString());
  });

  it("a stale from throws ConflictError and nothing in that call persists", async () => {
    const before = (await events(b)).length;
    await expect(
      store.apply(
        batchId,
        [
          { itemId: b, from: "draft", to: "approved", eventKind: "approve" }, // valid on its own
          { itemId: a, from: "draft", to: "approved", eventKind: "approve" }, // stale: a is already approved
        ],
        "approved",
        sessionId,
        later,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await item(b)).status).toBe("draft");
    expect((await item(b)).approved_at).toBeNull();
    expect((await events(b)).length).toBe(before);
    expect((await batchRow()).approved_at.toISOString()).toBe(now.toISOString());
  });

  it("unapprove clears approved_at/approved_session; batch back to draft", async () => {
    await store.apply(batchId, [{ itemId: a, from: "approved", to: "draft", eventKind: "unapprove" }], "draft", sessionId, later);
    const r = await item(a);
    expect(r).toMatchObject({ status: "draft", approved_at: null, approved_session: null });
    expect((await batchRow())).toMatchObject({ status: "draft", approved_at: null });
  });

  it("edit writes the patched columns only and an event with detail", async () => {
    const patch = { caption: "edited caption", scheduled_for: "2099-01-07T15:00:00.000Z" };
    await store.apply(batchId, [{ itemId: b, from: "draft", to: "draft", eventKind: "edit", patch }], "draft", null, later);
    const r = await item(b);
    expect(r.caption).toBe("edited caption");
    expect(r.scheduled_for.toISOString()).toBe("2099-01-07T15:00:00.000Z");
    expect(r.title).toBe("Test title");
    expect((await events(b)).at(-1)).toMatchObject({ kind: "edit", from_status: "draft", to_status: "draft", detail: patch, session_id: null });

    await store.apply(batchId, [{ itemId: b, from: "draft", to: "draft", eventKind: "edit", patch: { title: null, scheduled_for: null } }], "draft", null, later);
    expect(await item(b)).toMatchObject({ title: null, scheduled_for: null, caption: "edited caption" });
  });

  it("addItem creates an untimed draft with an 'add' event; refuses unknown media/batch", async () => {
    const id = await store.addItem(batchId, cleanMedia.id, "tiktok", sessionId, later);
    expect(await item(id)).toMatchObject({ status: "draft", caption: "", title: null, scheduled_for: null, media_id: cleanMedia.id, platform: "tiktok" });
    expect((await events(id))[0]).toMatchObject({ kind: "add", from_status: null, to_status: "draft", session_id: sessionId });
    await expect(store.addItem(batchId, randomUUID(), "tiktok", null, later)).rejects.toThrow(/media/);
    await expect(store.addItem(randomUUID(), cleanMedia.id, "tiktok", null, later)).rejects.toThrow(/batch/);
  });

  it("listBatches includes the batch with counts; listLibraryMedia lists clips", async () => {
    const list = await store.listBatches(100);
    const mine = list.find((x) => x.id === batchId);
    expect(mine).toMatchObject({ weekStart: "2099-01-05", status: "draft" });
    expect(mine!.counts.draft).toBe(3);
    expect(Object.keys(mine!.counts).sort()).toEqual(["approved", "draft", "failed", "published", "publishing", "queued", "rejected", "unknown"]);
    const weeks = list.map((x) => x.weekStart);
    expect([...weeks].sort().reverse()).toEqual(weeks);
    const lib = await store.listLibraryMedia(500);
    expect(lib.find((m) => m.id === cleanMedia.id)).toMatchObject({ hasCleanFile: true });
  });
});
