import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findCapBreaches, type CadenceSettings, type Platform } from "@autopilot/core";
import { loadCadence } from "@autopilot/db";
import { PgBatchStore } from "../../batches/pg-store.js";
import { previewRescheduleMissed, rescheduleMissed } from "../reschedule.js";

/**
 * F19 S1 against the scratch DB (DATABASE_URL). Fixtures sit in 2097-08 (one approved batch, week
 * 2097-08-03) and `now` is set there. Every fixture uses a media row WITHOUT a clean file (r2_key null),
 * so the outbox's listDue never sees them while other DB tests tick in 2099. Items are upserted by
 * ingest_key and rejected at the end (never deleted); leftovers from an earlier run are rejected first,
 * so they never count as existing posts.
 */
const url = process.env.DATABASE_URL;
const WEEK = "2097-08-03";
const KEY = "test-f19-resched:";
const TZ = "UTC";
const NOW = new Date("2097-08-12T12:00:00.000Z");
const TEST_SESSION_HASH = "test-f19-reschedule-db";

describe.skipIf(!url)("rescheduleMissed (db)", () => {
  let pool: pg.Pool;
  let sessionId: string;
  let cadence: CadenceSettings;
  let eventsBefore: number;
  let batchId: string;
  const id: Record<string, string> = {};

  const item = async (i: string) => (await pool.query("select * from batch_items where id = $1", [i])).rows[0];
  const newEvents = async (i: string) => (await pool.query("select * from batch_item_events where batch_item_id = $1 and id > $2 order by id", [i, eventsBefore])).rows;
  const alert = async (i: string) => (await pool.query("select * from alerts where batch_item_id = $1 and kind = 'missed-slot'", [i])).rows[0];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    const media = (await pool.query("select id from media where r2_key is null order by created_at, id limit 1")).rows[0];
    if (!media) throw new Error("seed the dev DB first (pnpm dev:seed): need media without r2_key");
    cadence = await loadCadence(pool);
    sessionId = (
      await pool.query(
        `insert into auth_sessions (token_hash, expires_at, hard_expires_at, revoked_at)
         values ($1, now() + interval '1 day', now() + interval '1 day', now())
         on conflict (token_hash) do update set revoked_at = coalesce(auth_sessions.revoked_at, now()) returning id`,
        [TEST_SESSION_HASH],
      )
    ).rows[0].id;
    const found = (await pool.query("select id from batches where week_start = $1 order by created_at, id limit 1", [WEEK])).rows[0];
    batchId = found?.id ?? (await pool.query("insert into batches (week_start, status) values ($1, 'approved') returning id", [WEEK])).rows[0].id;
    await pool.query("update batches set status = 'approved', approved_at = $2 where id = $1", [batchId, NOW]);
    await pool.query("update batch_items set status = 'rejected', approved_at = null where ingest_key like $1", [`${KEY}%`]);

    const fixture = async (key: string, platform: Platform, status: string, at: string, caption: string): Promise<string> => {
      const r = await pool.query(
        `insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status, ingest_key, approved_at)
         values ($1, $2, $3, $4, $5, $6, $7, case when $6 in ('approved', 'published') then $8::timestamptz end)
         on conflict (ingest_key) where ingest_key is not null do update
           set batch_id = excluded.batch_id, platform = excluded.platform, caption = excluded.caption, title = null,
               scheduled_for = excluded.scheduled_for, status = excluded.status, approved_at = excluded.approved_at
         returning id`,
        [batchId, media.id, platform, caption, at, status, `${KEY}${key}`, new Date("2097-08-01T00:00:00Z")],
      );
      const itemId = r.rows[0].id as string;
      if (status === "approved" || status === "draft" || status === "unknown") {
        await pool.query(
          `insert into alerts (kind, batch_item_id, platform, message, created_at) values ('missed-slot', $1, $2, 'test: missed', $3)
           on conflict (kind, batch_item_id) do update set acknowledged_at = null, acknowledged_session = null`,
          [itemId, platform, NOW],
        );
      }
      return itemId;
    };
    id.day11 = await fixture("ig-day11", "instagram", "approved", "2097-08-10T09:00:00Z", "Day 11 of the climb");
    id.day10 = await fixture("ig-day10", "instagram", "approved", "2097-08-10T10:00:00Z", "Day 10 of the climb");
    id.evergreen = await fixture("ig-evergreen", "instagram", "approved", "2097-08-10T08:00:00Z", "Morning stretch");
    id.draft = await fixture("ig-draft", "instagram", "draft", "2097-08-10T07:00:00Z", "A draft");
    id.published = await fixture("ig-published", "instagram", "published", "2097-08-10T06:00:00Z", "Already out");
    id.tiktok = await fixture("tt-missed", "tiktok", "approved", "2097-08-10T10:00:00Z", "Evergreen tiktok");
    id.ytA = await fixture("yt-a", "youtube", "approved", "2097-08-10T10:00:00Z", "Clip A");
    id.ytB = await fixture("yt-b", "youtube", "approved", "2097-08-10T11:00:00Z", "Clip B");
    id.ytSame = await fixture("yt-same", "youtube", "approved", "2097-08-10T09:00:00Z", "Clip same");
    id.applyReject = await fixture("apply-reject", "instagram", "approved", "2097-08-09T10:00:00Z", "Reject me");
    id.applyEdit = await fixture("apply-edit", "youtube", "approved", "2097-08-09T10:00:00Z", "Edit me");
    id.applyPub = await fixture("apply-pub", "tiktok", "unknown", "2097-08-09T10:00:00Z", "Record me");
    // TikTok is at its cap today and tomorrow (drafts count as existing posts, and nothing ever fires a draft).
    for (const date of ["2097-08-12", "2097-08-13"]) {
      for (let i = 0; i < cadence.dailyCaps.tiktok; i++) {
        const at = new Date(Date.parse(`${date}T00:00:00Z`) + i * Math.max(1, cadence.minGapMinutes) * 60_000).toISOString();
        await fixture(`tt-fill:${date}:${i}`, "tiktok", "draft", at, "Cap filler");
      }
    }
    eventsBefore = Number((await pool.query("select coalesce(max(id), 0) as m from batch_item_events")).rows[0].m);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("update alerts set acknowledged_at = coalesce(acknowledged_at, now()) where batch_item_id in (select id from batch_items where ingest_key like $1)", [`${KEY}%`]);
    await pool.query("update batch_items set status = 'rejected', approved_at = null where ingest_key like $1", [`${KEY}%`]);
    await pool.end();
  });

  it("preview is read-only and lists the missed ones (draft and published are not-missed)", async () => {
    const before = await item(id.day10!);
    const rows = await previewRescheduleMissed(pool, [id.day10!, id.draft!, id.published!], NOW, TZ);
    expect(rows.map((r) => [r.id, r.reason ?? "ok"])).toEqual([
      [id.day10, "ok"],
      ...[id.draft, id.published].sort().map((i) => [i, "not-missed"]),
    ]);
    expect((await item(id.day10!)).scheduled_for).toEqual(before.scheduled_for);
    const all = await previewRescheduleMissed(pool, "all", NOW, TZ);
    const mine = new Set(all.map((r) => r.id));
    for (const k of ["day10", "day11", "evergreen", "tiktok", "ytA", "ytB", "ytSame"]) expect(mine.has(id[k]!)).toBe(true);
    expect(mine.has(id.draft!) || mine.has(id.published!)).toBe(false);
  });

  it("Day 10 before Day 11 before evergreen; stays approved, same idempotency key, event written, alert acked; draft/published untouched", async () => {
    const keys = Object.fromEntries(await Promise.all(["day10", "day11", "evergreen"].map(async (k) => [k, (await item(id[k]!)).idempotency_key])));
    const draftBefore = await item(id.draft!);
    const pubBefore = await item(id.published!);
    const rows = await rescheduleMissed(pool, [id.evergreen!, id.day11!, id.draft!, id.day10!, id.published!], NOW, TZ, sessionId);

    expect(rows.slice(0, 3).map((r) => r.id)).toEqual([id.day10, id.day11, id.evergreen]);
    const [d10, d11, ev] = rows as [(typeof rows)[0], (typeof rows)[0], (typeof rows)[0]];
    expect(d10.series).toEqual({ key: "climb", day: 10 });
    expect(Date.parse(d10.to!)).toBeGreaterThanOrEqual(NOW.getTime() + 10 * 60_000);
    expect(Date.parse(d10.to!)).toBeLessThan(Date.parse(d11.to!));
    expect(Date.parse(d11.to!)).toBeLessThan(Date.parse(ev.to!));
    expect(Date.parse(ev.to!)).toBeLessThan(NOW.getTime() + 7 * 86_400_000);
    expect(rows.filter((r) => r.reason === "not-missed").map((r) => r.id).sort()).toEqual([id.draft, id.published].sort());

    for (const r of [d10, d11, ev]) {
      const row = await item(r.id);
      expect(row.status).toBe("approved");
      expect(row.scheduled_for.toISOString()).toBe(r.to);
      expect(row.approved_at.toISOString()).toBe(NOW.toISOString());
      expect(row.idempotency_key).toBe(keys[Object.keys(id).find((k) => id[k] === r.id)!]);
      const ev = await newEvents(r.id);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ kind: "move", from_status: "approved", to_status: "approved", session_id: sessionId, detail: { reason: "missed-reschedule", from: r.from, to: r.to } });
      expect(await alert(r.id)).toBeUndefined(); // resolved: removed, so a later miss can raise a fresh alert
    }
    const draftAfter = await item(id.draft!);
    expect([draftAfter.status, draftAfter.scheduled_for, draftAfter.updated_at]).toEqual([draftBefore.status, draftBefore.scheduled_for, draftBefore.updated_at]);
    expect((await item(id.published!)).scheduled_for).toEqual(pubBefore.scheduled_for);
    expect(await newEvents(id.draft!)).toEqual([]);
    expect(await newEvents(id.published!)).toEqual([]);
    expect((await alert(id.draft!)).acknowledged_at).toBeNull(); // only the moved items' alerts
  });

  it("a second call is a no-op (not-missed), nothing written", async () => {
    const before = await Promise.all([id.day10!, id.day11!, id.evergreen!].map(item));
    const rows = await rescheduleMissed(pool, [id.day10!, id.day11!, id.evergreen!], NOW, TZ, sessionId);
    expect(rows.every((r) => r.to === null && r.reason === "not-missed")).toBe(true);
    const after = await Promise.all([id.day10!, id.day11!, id.evergreen!].map(item));
    expect(after.map((r) => r.scheduled_for)).toEqual(before.map((r) => r.scheduled_for));
    for (const i of [id.day10!, id.day11!, id.evergreen!]) expect(await newEvents(i)).toHaveLength(1);
  });

  it("caps hold against existing posts: TikTok full today and tomorrow → the day after", async () => {
    const preview = await previewRescheduleMissed(pool, [id.tiktok!], NOW, TZ);
    const [row] = await rescheduleMissed(pool, [id.tiktok!], NOW, TZ, sessionId);
    expect(row!.to).toBe(preview[0]!.to);
    expect(row!.to! >= "2097-08-14").toBe(true);
    const { rows } = await pool.query(
      `select platform, scheduled_for from batch_items where platform = 'tiktok' and status <> 'rejected' and scheduled_for >= '2097-08-11' and scheduled_for < '2097-08-21'`,
    );
    expect(findCapBreaches(rows.map((r) => ({ platform: r.platform as Platform, scheduledFor: r.scheduled_for.toISOString() })), cadence, TZ)).toEqual([]);
  });

  it("concurrent calls never hand two posts the same slot (the lock serializes them)", async () => {
    const [a, b] = await Promise.all([rescheduleMissed(pool, [id.ytA!], NOW, TZ, sessionId), rescheduleMissed(pool, [id.ytB!], NOW, TZ, sessionId)]);
    expect(a![0]!.to && b![0]!.to).toBeTruthy();
    expect(Math.abs(Date.parse(a![0]!.to!) - Date.parse(b![0]!.to!))).toBeGreaterThanOrEqual(cadence.minGapMinutes * 60_000);
    expect(Math.abs(Date.parse(a![0]!.to!) - Date.parse(b![0]!.to!))).toBeGreaterThan(0);
  });

  it("the same item in two concurrent calls moves once", async () => {
    const results = await Promise.all([rescheduleMissed(pool, [id.ytSame!], NOW, TZ, sessionId), rescheduleMissed(pool, [id.ytSame!], NOW, TZ, null)]);
    const moved = results.flat().filter((r) => r.to);
    expect(moved).toHaveLength(1);
    expect(results.flat().filter((r) => r.reason === "not-missed")).toHaveLength(1);
    expect(await newEvents(id.ytSame!)).toHaveLength(1);
    expect((await item(id.ytSame!)).scheduled_for.toISOString()).toBe(moved[0]!.to);
  });

  it("PgBatchStore.apply acknowledges the missed-slot alert of an item whose status or time it changes, in the same transaction", async () => {
    const store = new PgBatchStore(pool);
    const at = new Date(NOW.getTime() + 60_000);
    await store.apply(batchId, [{ itemId: id.applyReject!, from: "approved", to: "rejected", eventKind: "reject" }], "approved", sessionId, at);
    await store.apply(batchId, [{ itemId: id.applyEdit!, from: "approved", to: "draft", eventKind: "edit", patch: { caption: "Edited" } }], "approved", sessionId, at);
    await store.apply(
      batchId,
      [{ itemId: id.applyPub!, from: "unknown", to: "published", eventKind: "record-published", patch: { platform_post_url: "https://example.com/p/1" } }],
      "approved",
      sessionId,
      at,
    );
    for (const i of [id.applyReject!, id.applyEdit!, id.applyPub!]) {
      const a = await alert(i);
      expect(a.acknowledged_at?.toISOString()).toBe(at.toISOString());
      expect(a.acknowledged_session).toBe(sessionId);
    }
    expect((await alert(id.draft!)).acknowledged_at).toBeNull(); // untouched item keeps its alert
  });

  it("ignores ids that aren't uuids", async () => {
    expect(await rescheduleMissed(pool, ["nope", "'; drop table x; --"], NOW, TZ, sessionId)).toEqual([]);
  });
});
