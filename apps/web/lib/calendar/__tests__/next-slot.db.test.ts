import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localDate, type CadenceSettings, type Platform } from "@autopilot/core";
import { loadCadence } from "@autopilot/db";
import { nextAvailableSlot } from "../next-slot.js";

/** nextAvailableSlot against the scratch DB. Fixtures sit in 2098-03 on media WITHOUT a clean file; rejected at the end. */
const url = process.env.DATABASE_URL;
const WEEK = "2098-03-02";
const KEY = "test-next-slot:";
const TZ = "UTC";
const AFTER = new Date("2098-03-02T00:00:00.000Z");

describe.skipIf(!url)("nextAvailableSlot (db)", () => {
  let pool: pg.Pool;
  let cadence: CadenceSettings;
  let batchId: string;
  let mediaId: string;

  const put = async (key: string, platform: Platform, at: string, status = "draft"): Promise<string> =>
    (
      await pool.query(
        `insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status, ingest_key)
         values ($1, $2, $3, 'Next slot filler', $4, $5, $6)
         on conflict (ingest_key) where ingest_key is not null do update set platform = excluded.platform, scheduled_for = excluded.scheduled_for, status = excluded.status, batch_id = excluded.batch_id
         returning id`,
        [batchId, mediaId, platform, at, status, `${KEY}${key}`],
      )
    ).rows[0].id as string;
  const reject = () => pool.query("update batch_items set status = 'rejected', approved_at = null where ingest_key like $1", [`${KEY}%`]);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 });
    const media = (await pool.query("select id from media where r2_key is null order by created_at, id limit 1")).rows[0];
    if (!media) throw new Error("seed the dev DB first (pnpm dev:seed): need media without r2_key");
    mediaId = media.id;
    cadence = await loadCadence(pool);
    const found = (await pool.query("select id from batches where week_start = $1 order by created_at, id limit 1", [WEEK])).rows[0];
    batchId = found?.id ?? (await pool.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [WEEK])).rows[0].id;
    await reject();
  });
  afterAll(async () => {
    if (!pool) return;
    await reject();
    await pool.end();
  });

  it("returns the earliest free slot after `after`, within 7 days", async () => {
    const s = await nextAvailableSlot(pool, "tiktok", AFTER, TZ, []);
    expect(s).not.toBeNull();
    const t = Date.parse(s!);
    expect(t).toBeGreaterThan(AFTER.getTime());
    expect(t).toBeLessThan(AFTER.getTime() + 7 * 86_400_000);
  });

  it("skips a taken slot, unless that post is the one being moved", async () => {
    const first = (await nextAvailableSlot(pool, "tiktok", AFTER, TZ, []))!;
    const mine = await put("taken", "tiktok", first);
    const next = (await nextAvailableSlot(pool, "tiktok", AFTER, TZ, []))!;
    expect(next).not.toBe(first);
    expect(Date.parse(next)).toBeGreaterThan(Date.parse(first));
    expect(await nextAvailableSlot(pool, "tiktok", AFTER, TZ, [mine])).toBe(first);
    await reject();
  });

  it("respects the daily cap (a full day pushes the slot to a later day) and other platforms are independent", async () => {
    const first = (await nextAvailableSlot(pool, "tiktok", AFTER, TZ, []))!;
    const day = localDate(new Date(first), TZ);
    for (let i = 0; i < cadence.dailyCaps.tiktok; i++) {
      const at = new Date(Date.parse(`${day}T00:00:00Z`) + i * Math.max(1, cadence.minGapMinutes) * 60_000).toISOString();
      await put(`fill:${i}`, "tiktok", at);
    }
    const next = (await nextAvailableSlot(pool, "tiktok", AFTER, TZ, []))!;
    expect(next).not.toBeNull();
    expect(localDate(new Date(next), TZ) > day).toBe(true);
    const yt = await nextAvailableSlot(pool, "youtube", AFTER, TZ, []);
    expect(yt).not.toBeNull();
    await reject();
  });

  it("ignores rejected posts", async () => {
    const first = (await nextAvailableSlot(pool, "instagram", AFTER, TZ, []))!;
    await put("rej", "instagram", first, "rejected");
    expect(await nextAvailableSlot(pool, "instagram", AFTER, TZ, [])).toBe(first);
  });
});
