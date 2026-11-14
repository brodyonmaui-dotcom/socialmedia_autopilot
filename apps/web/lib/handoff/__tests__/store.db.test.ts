import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_CLEAN_FILE } from "../logic.js";
import { dropItem, listHandoff, loadShareable, markPosted, RELOAD, SKIP_LOCK_KEY, skipToNextDay } from "../store.js";

/**
 * Runs against a real dev DB (DATABASE_URL), like batches/pg-store.db.test.ts. The store opens its own
 * transactions, so the test uses two throwaway batches far in the future (weeks 2099-03-02, approved,
 * and 2099-03-09, draft), found-or-created and reset each run; fixture items are found by a title tag.
 * At the end every item in them is left rejected and both batches draft. Nothing is ever deleted.
 */
const url = process.env.DATABASE_URL;
const TZ = "Europe/London"; // fixture zone, not the creator's
const NOW = new Date("2099-03-04T12:00:00.000Z"); // local day 2099-03-04 (GMT)
const SESSION = randomUUID();

describe.skipIf(!url)("handoff store (db)", () => {
  let pool: pg.Pool;
  let okBatch: string;
  let draftBatch: string;
  let clean: string;
  let raw: string;
  const ids: Record<string, string> = {};

  const item = async (id: string) => (await pool.query("select * from batch_items where id = $1", [id])).rows[0];
  const events = async (id: string, kind: string) =>
    (await pool.query("select * from batch_item_events where batch_item_id = $1 and kind = $2 and session_id = $3 order by id", [id, kind, SESSION])).rows;
  const ours = <T extends { batchId: string }>(xs: T[]): T[] => xs.filter((x) => x.batchId === okBatch || x.batchId === draftBatch);

  const batch = async (week: string, status: string): Promise<string> => {
    const found = (await pool.query("select id from batches where week_start = $1 order by created_at, id limit 1", [week])).rows[0];
    const id = found?.id ?? (await pool.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [week])).rows[0].id;
    await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1", [id]);
    await pool.query(`update batches set status = $2, approved_at = case when $2 = 'approved' then now() else null end, updated_at = now() where id = $1`, [id, status]);
    return id;
  };

  const fixture = async (tag: string, batchId: string, media: string, platform: string, at: string, status: string, approved: boolean): Promise<string> => {
    const hit = (await pool.query("select id from batch_items where batch_id = $1 and title = $2 order by created_at, id limit 1", [batchId, tag])).rows[0];
    const id: string =
      hit?.id ??
      (await pool.query("insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status) values ($1, $2, $3, '', $4, $5, 'draft') returning id", [batchId, media, platform, tag, at]))
        .rows[0].id;
    await pool.query(
      `update batch_items set media_id = $2, platform = $3, caption = 'Pull day, slow and boring\nsecond line #gym #lifting #extra', scheduled_for = $4,
              status = $5, approved_at = case when $6 then now() else null end, approved_session = null, platform_post_url = null, updated_at = now()
        where id = $1`,
      [id, media, platform, at, status, approved],
    );
    return id;
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    const c = (await pool.query("select id from media where r2_key is not null order by created_at, id limit 1")).rows[0];
    const r = (await pool.query("select id from media where r2_key is null order by created_at, id limit 1")).rows[0];
    if (!c || !r) throw new Error("seed the dev DB first (pnpm dev:seed): need media with and without r2_key");
    clean = c.id;
    raw = r.id;
    okBatch = await batch("2099-03-02", "approved");
    draftBatch = await batch("2099-03-09", "draft");

    ids.today = await fixture("f10-today", okBatch, clean, "snapchat", "2099-03-04T18:00:00Z", "approved", true);
    ids.missedRaw = await fixture("f10-missed-raw", okBatch, raw, "snapchat", "2099-03-02T18:00:00Z", "approved", true);
    ids.future = await fixture("f10-future", okBatch, clean, "snapchat", "2099-03-06T18:00:00Z", "approved", true);
    ids.noApprovedAt = await fixture("f10-no-approved-at", okBatch, clean, "snapchat", "2099-03-04T08:00:00Z", "approved", false);
    ids.instagram = await fixture("f10-instagram", okBatch, clean, "instagram", "2099-03-04T08:00:00Z", "approved", true);
    ids.draftStatus = await fixture("f10-draft", okBatch, clean, "snapchat", "2099-03-04T08:00:00Z", "draft", false);
    ids.draftBatch = await fixture("f10-draft-batch", draftBatch, clean, "snapchat", "2099-03-04T08:00:00Z", "approved", true);
  });

  afterAll(async () => {
    for (const b of [okBatch, draftBatch]) {
      if (!b) continue;
      await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1", [b]);
      await pool.query("update batches set status = 'draft', approved_at = null where id = $1", [b]);
    }
    await pool?.end();
  });

  it("lists only snapchat + approved + approved_at + batch approved, due today or missed", async () => {
    const l = await listHandoff(pool, NOW, TZ, []);
    expect(ours(l.today).map((i) => i.id)).toEqual([ids.today]);
    expect(ours(l.missed).map((i) => i.id)).toEqual([ids.missedRaw]);
    const t = ours(l.today)[0]!;
    expect(t).toMatchObject({ bucket: "today", localDay: "2099-03-04", hasCleanFile: true, blocks: [], caption: "Pull day, slow and boring #gym #lifting" });
    expect(t.checklist.length).toBeGreaterThan(0);
    expect(ours(l.missed)[0]!.blocks).toEqual([NO_CLEAN_FILE]);
  });

  it("loadShareable: only the due item with a clean file", async () => {
    expect(await loadShareable(pool, ids.today!, NOW, TZ)).toEqual({ r2Key: expect.any(String) });
    for (const k of ["missedRaw", "future", "noApprovedAt", "instagram", "draftStatus", "draftBatch"]) {
      expect(await loadShareable(pool, ids[k]!, NOW, TZ), k).toBeNull();
    }
    expect(await loadShareable(pool, randomUUID(), NOW, TZ)).toBeNull();
  });

  it("markPosted is conditional, drops an off-host link and writes one event with the session", async () => {
    expect(await markPosted(pool, ids.today!, SESSION, "https://snapchat.com.evil.example/x", NOW)).toEqual({ ok: true });
    const r = await item(ids.today!);
    expect(r.status).toBe("published");
    expect(r.platform_post_url).toBeNull();
    expect(r.updated_at.toISOString()).toBe(NOW.toISOString());
    expect(await markPosted(pool, ids.today!, SESSION, null, NOW)).toEqual({ ok: false, reason: RELOAD });
    const ev = await events(ids.today!, "snap-posted");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ from_status: "approved", to_status: "published", session_id: SESSION });
    // Not listed any more; the others are refused too.
    expect(ours((await listHandoff(pool, NOW, TZ, [])).today)).toEqual([]);
    for (const k of ["noApprovedAt", "instagram", "draftBatch"]) expect((await markPosted(pool, ids[k]!, SESSION, null, NOW)).ok, k).toBe(false);
  });

  it("markPosted keeps a snapchat.com https link", async () => {
    const id = await fixture("f10-link", okBatch, clean, "snapchat", "2099-03-03T18:00:00Z", "approved", true);
    expect(await markPosted(pool, id, SESSION, "https://www.snapchat.com/spotlight/abc", NOW)).toEqual({ ok: true });
    expect((await item(id)).platform_post_url).toBe("https://www.snapchat.com/spotlight/abc");
  });

  it("two concurrent markPosted calls publish once, with one event", async () => {
    const id = await fixture("f10-post-race", okBatch, clean, "snapchat", "2099-03-01T18:00:00Z", "approved", true);
    const rs = await Promise.all([markPosted(pool, id, SESSION, null, NOW), markPosted(pool, id, SESSION, null, NOW)]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok)).toEqual([{ ok: false, reason: RELOAD }]);
    expect(await events(id, "snap-posted")).toHaveLength(1);
  });

  it("skip moves a missed item to the next free day after today, same local time, audited", async () => {
    expect(await skipToNextDay(pool, ids.missedRaw!, SESSION, TZ, NOW)).toEqual({ ok: true, to: "2099-03-05" });
    const r = await item(ids.missedRaw!);
    expect(r.scheduled_for.toISOString()).toBe("2099-03-05T18:00:00.000Z");
    expect(r.status).toBe("approved");
    const ev = await events(ids.missedRaw!, "snap-skip");
    expect(ev.at(-1)).toMatchObject({ from_status: "approved", to_status: "approved", detail: { from: "2099-03-02T18:00:00.000Z", to: "2099-03-05T18:00:00.000Z" } });
    // Now in the future: not due, so a second skip is refused.
    expect((await skipToNextDay(pool, ids.missedRaw!, SESSION, TZ, NOW)).ok).toBe(false);
    for (const k of ["noApprovedAt", "instagram", "draftBatch"]) expect((await skipToNextDay(pool, ids[k]!, SESSION, TZ, NOW)).ok, k).toBe(false);
  });

  it("two concurrent skips never land on the same day", async () => {
    const x = await fixture("f10-race-x", okBatch, clean, "snapchat", "2099-03-04T09:00:00Z", "approved", true);
    const y = await fixture("f10-race-y", okBatch, clean, "snapchat", "2099-03-04T10:00:00Z", "approved", true);
    const [rx, ry] = await Promise.all([skipToNextDay(pool, x, SESSION, TZ, NOW), skipToNextDay(pool, y, SESSION, TZ, NOW)]);
    expect(rx.ok && ry.ok).toBe(true);
    const days = [rx, ry].map((r) => (r.ok ? r.to : "")).sort();
    // 03-05 (skipped item) and 03-06 (future item) are taken.
    expect(days).toEqual(["2099-03-07", "2099-03-08"]);
  });

  it("a skip waits for an in-flight skip and sees the day it took", async () => {
    // Simulate skip A mid-transaction: it holds the skip lock and has moved z onto 2099-03-09 but not committed.
    const z = await fixture("f10-race-z", okBatch, clean, "snapchat", "2099-03-04T09:30:00Z", "approved", true);
    const w = await fixture("f10-race-w", okBatch, clean, "snapchat", "2099-03-04T10:30:00Z", "approved", true);
    const a = await pool.connect();
    try {
      await a.query("begin");
      await a.query("select pg_advisory_xact_lock(hashtext($1))", [SKIP_LOCK_KEY]);
      await a.query("update batch_items set scheduled_for = '2099-03-09T09:30:00Z' where id = $1", [z]);
      let settled = false;
      const b = skipToNextDay(pool, w, SESSION, TZ, NOW).finally(() => (settled = true));
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false); // B is blocked behind A
      await a.query("commit");
      // 03-05..03-08 are taken by now; without the lock B would read z on 03-04 and pick 03-09 too.
      expect(await b).toEqual({ ok: true, to: "2099-03-10" });
    } finally {
      await a.query("rollback").catch(() => {});
      a.release();
    }
  });

  it("drop rejects with F2 semantics + a snap-drop event; a second drop is refused", async () => {
    expect(await dropItem(pool, ids.future!, SESSION, NOW)).toEqual({ ok: true });
    const r = await item(ids.future!);
    expect(r).toMatchObject({ status: "rejected", approved_at: null, approved_session: null });
    expect(await events(ids.future!, "snap-drop")).toHaveLength(1);
    expect(await dropItem(pool, ids.future!, SESSION, NOW)).toEqual({ ok: false, reason: RELOAD });
    // Other items in the batch are still live, so it stays approved.
    expect((await pool.query("select status from batches where id = $1", [okBatch])).rows[0].status).toBe("approved");
  });
});
