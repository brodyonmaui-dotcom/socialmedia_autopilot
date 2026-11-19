import { localToUtc } from "@autopilot/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCaptionsDue } from "../dashboard.js";

/**
 * F14 Home strip against the scratch DB (DATABASE_URL). A throwaway batch in a far-future week
 * (2097-04-08); fixtures are upserted by ingest_key into their starting state each run and rejected at
 * the end. Nothing is ever deleted. America/New_York is an arbitrary fixture zone.
 */
const url = process.env.DATABASE_URL;
const TZ = "America/New_York";
const WEEK = "2097-04-08";

describe.skipIf(!url)("loadCaptionsDue (db)", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 });
    const media = (await pool.query("select id from media where r2_key is not null order by created_at, id limit 1")).rows[0];
    if (!media) throw new Error("seed the dev DB first (pnpm dev:seed): need media with an r2_key");
    const found = (await pool.query("select id from batches where week_start = $1 and status <> 'archived' order by created_at, id limit 1", [WEEK])).rows[0];
    const batchId = found?.id ?? (await pool.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [WEEK])).rows[0].id;
    const fixture = (key: string, platform: string, caption: string, title: string | null, status: string, at: Date | null, origin: string | null) =>
      pool.query(
        `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, origin, ingest_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (ingest_key) where ingest_key is not null do update
           set batch_id = excluded.batch_id, caption = excluded.caption, title = excluded.title, scheduled_for = excluded.scheduled_for,
               status = excluded.status, origin = excluded.origin, approved_at = null`,
        [batchId, media.id, platform, caption, title, at, status, origin, `test-f14-t2-home:${key}`],
      );
    const mon = (hhmm: string) => localToUtc(WEEK, hhmm, TZ);
    // Counted: empty caption (weekly + editor), YouTube with an empty title, an untimed draft of the week.
    await fixture("ig", "instagram", "", null, "draft", mon("18:00"), "weekly");
    await fixture("yt", "youtube", "Has a caption.", "", "draft", mon("18:30"), "weekly");
    await fixture("ed", "tiktok", "  ", null, "draft", mon("19:00"), "editor");
    await fixture("untimed", "tiktok", "", null, "draft", null, null);
    // Not counted: written, approved, rejected, the week after, Sunday-night local before the week (UTC Monday).
    await fixture("written", "youtube", "Done.", "Done", "draft", mon("20:00"), "weekly");
    await fixture("approved", "instagram", "", null, "approved", mon("20:00"), null);
    await fixture("rejected", "instagram", "", null, "rejected", mon("21:00"), "weekly");
    await fixture("later", "instagram", "", null, "draft", localToUtc("2097-04-15", "18:00", TZ), "weekly");
    await fixture("before", "instagram", "", null, "draft", localToUtc("2097-04-07", "22:00", TZ), "weekly");
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("update batch_items set status = 'rejected', approved_at = null where ingest_key like 'test-f14-t2-home:%'");
    await pool.end();
  });

  it("counts next week's drafts that need text, in the creator zone", async () => {
    // Sun 2097-04-07 12:00 local: next week = Mon 2097-04-08.
    const due = await loadCaptionsDue(pool, localToUtc("2097-04-07", "12:00", TZ), TZ);
    expect(due).toEqual({ weekStart: WEEK, count: 4, text: "Next week: 4 posts need captions", href: `/calendar?view=week&d=${WEEK}&status=draft` });
  });

  it("hides the strip when the week has nothing to write", async () => {
    expect(await loadCaptionsDue(pool, localToUtc("2097-05-01", "12:00", TZ), TZ)).toBeNull();
  });
});
