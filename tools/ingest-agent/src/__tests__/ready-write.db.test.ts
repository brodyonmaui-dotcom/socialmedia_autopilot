import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCalendarDays, type Platform } from "@autopilot/core";
import { createPool } from "@autopilot/db";
import { ingestKey, mondayOf, type PlannedItem } from "../ready/plan.js";
import type { Sidecar } from "../ready/sidecar.js";
import { existingIngestKeys, existingPosts, upsertMedia, writeReadyItems } from "../ready/write.js";

/**
 * F15 writer against the dev DB (DATABASE_URL, e.g. postgres://ap:ap@localhost:5432/autopilot_dev).
 * Dev-DB safety: a far-future week in 2098 (random per run) and a random content hash, so no real
 * row is touched. Nothing is deleted: created items are marked rejected and their alerts acknowledged.
 */
const url = process.env.DATABASE_URL;
const WEEK = mondayOf(addCalendarDays("2098-01-05", 7 * Math.floor(Math.random() * 50)));
const HASH = `f15test-${randomBytes(12).toString("hex")}`;
const PLATFORMS: Platform[] = ["instagram", "youtube", "tiktok", "snapchat"];

const sidecar: Sidecar = {
  version: 1,
  pillar: "workout-log",
  platforms: PLATFORMS,
  when: "today",
  caption: { instagram: "a", tiktok: "b", youtube: { title: "t", description: "d" }, snapchat: "s" },
  soundInApp: true,
  approvedInEditor: "2098-01-01T00:00:00Z",
  source: "workout-assembly",
};

const items: PlannedItem[] = PLATFORMS.map((platform, i) => ({
  platform,
  ingestKey: ingestKey(HASH, platform),
  caption: "cap",
  title: platform === "youtube" ? "t" : null,
  scheduledFor: i === 3 ? null : new Date(`${addCalendarDays(WEEK, 2)}T1${i}:00:00Z`).toISOString(),
  weekStart: WEEK,
  tiktokDraft: platform === "tiktok",
  flags: i === 3 ? ["no-slot"] : [],
}));

describe.skipIf(!url)("writeReadyItems (db)", () => {
  let pool: ReturnType<typeof createPool>;
  let mediaId: string;

  const rows = async () =>
    (await pool.query(`select id, batch_id, status, origin, trial, scheduled_for from batch_items where ingest_key like $1 order by platform`, [`${HASH}:%`])).rows;
  const alertCount = async () =>
    Number((await pool.query(`select count(*)::int as n from alerts a join batch_items bi on bi.id = a.batch_item_id where bi.ingest_key like $1 and a.kind = 'ready-for-approval'`, [`${HASH}:%`])).rows[0].n);

  beforeAll(async () => {
    pool = createPool(url!);
    mediaId = await upsertMedia(pool, {
      contentHash: HASH,
      sourcePath: "test/clip.mp4",
      r2Key: `library/${HASH}.mp4`,
      durationS: 12,
      width: 1080,
      height: 1920,
      pillar: "workout-log",
      qa: { warnings: [] },
      capturedAt: null,
    });
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`update batch_items set status = 'rejected', updated_at = now() where ingest_key like $1`, [`${HASH}:%`]);
    await pool.query(`update alerts set acknowledged_at = now() where acknowledged_at is null and batch_item_id in (select id from batch_items where ingest_key like $1)`, [`${HASH}:%`]);
    await pool.end();
  });

  it("media upsert: same id twice, an existing r2_key is kept", async () => {
    const again = await upsertMedia(pool, { contentHash: HASH, sourcePath: "x", r2Key: "library/other.mp4", durationS: 1, width: 1, height: 1, pillar: "other", qa: null, capturedAt: null });
    expect(again).toBe(mediaId);
    const m = (await pool.query(`select r2_key, pillar from media where id = $1`, [mediaId])).rows[0];
    expect(m).toEqual({ r2_key: `library/${HASH}.mp4`, pillar: "workout-log" });
  });

  it("two concurrent writes of the same render → one row per platform, one batch for the week, one alert each", async () => {
    const now = new Date();
    const [a, b] = await Promise.all([
      writeReadyItems(pool, { mediaId, sidecar, items, now }),
      writeReadyItems(pool, { mediaId, sidecar, items, now }),
    ]);
    expect(a.inserted.length + b.inserted.length).toBe(4);
    expect(a.existing.length + b.existing.length).toBe(4);
    const r = await rows();
    expect(r).toHaveLength(4);
    expect(new Set(r.map((x) => x.batch_id)).size).toBe(1);
    expect(r.every((x) => x.status === "draft" && x.origin === "editor")).toBe(true);
    const tiktok = r.find((x) => x.trial?.editor && x.trial.tiktokDraft === true);
    expect(tiktok?.trial.editor).toMatchObject({ source: "workout-assembly", pillar: "workout-log", when: "today", earliest: null });
    expect(r.filter((x) => x.scheduled_for === null)).toHaveLength(1);
    const batches = (await pool.query(`select id, status from batches where week_start = $1::date and status <> 'archived'`, [WEEK])).rows;
    expect(batches).toHaveLength(1);
    expect(batches[0].status).toBe("draft");
    expect(await alertCount()).toBe(4);
    const msg = (await pool.query(`select a.message, a.platform from alerts a join batch_items bi on bi.id = a.batch_item_id where bi.ingest_key = $1`, [ingestKey(HASH, "youtube")])).rows[0];
    expect(msg).toEqual({ message: "New from workout-assembly: workout-log · youtube", platform: "youtube" });
  });

  it("re-run → no new rows, no new alerts; keys and posts are readable", async () => {
    const res = await writeReadyItems(pool, { mediaId, sidecar, items, now: new Date() });
    expect(res.inserted).toEqual([]);
    expect(res.existing).toHaveLength(4);
    expect(await rows()).toHaveLength(4);
    expect(await alertCount()).toBe(4);
    expect((await existingIngestKeys(pool, items.map((i) => i.ingestKey))).sort()).toEqual(items.map((i) => i.ingestKey).sort());
    const posts = await existingPosts(pool, `${WEEK}T00:00:00Z`, `${addCalendarDays(WEEK, 7)}T00:00:00Z`);
    expect(posts.filter((p) => p.platform === "tiktok" && p.tiktokDraft)).not.toHaveLength(0);
  });
});
