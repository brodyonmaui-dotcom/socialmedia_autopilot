import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCalendarDays, localToUtc, weekdayIndex } from "@autopilot/core";
import { reportReadyMessage, runWeeklyReportOnce } from "../jobs/weekly-report.js";

/**
 * F14 weekly-report against the dev DB (DATABASE_URL). Everything runs inside one transaction on one
 * client that is rolled back at the end, so no row is left behind. Far-future random weeks; America/New_York
 * is an arbitrary fixture zone.
 */
const url = process.env.DATABASE_URL;
const TZ = "America/New_York";
const TAG = `f14wr-${randomBytes(6).toString("hex")}`;
const mondayOf = (ymd: string) => addCalendarDays(ymd, -weekdayIndex(ymd));
const WEEK = mondayOf(addCalendarDays("2111-01-06", 7 * Math.floor(Math.random() * 1500)));
const EMPTY_WEEK = addCalendarDays(WEEK, 70);
/** Monday 08:00 creator-local right after the week: when the cron fires. */
const mondayAfter = (w: string) => localToUtc(addCalendarDays(w, 7), "08:00", TZ);

describe.skipIf(!url)("weekly-report (db)", () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  const reports = async (w: string) => (await client.query(`select message, platform, batch_item_id from alerts where kind = 'report-ready' and message like $1`, [`%(from ${w})%`])).rows;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    client = await pool.connect();
    await client.query("begin");
    const media = (await client.query(`insert into media (content_hash, source_path, status) values ($1, '/Users/someone/clip.mov', 'used') returning id`, [TAG])).rows[0].id;
    const batch = (await client.query(`insert into batches (week_start, status) values ($1::date, 'approved') returning id`, [WEEK])).rows[0].id;
    const at = (d: number, hhmm: string) => localToUtc(addCalendarDays(WEEK, d), hhmm, TZ).toISOString();
    const rows: Array<[string, string, string]> = [
      ["instagram", at(0, "09:30"), "published"],
      ["youtube", at(3, "12:00"), "published"],
      ["tiktok", at(6, "23:30"), "published"], // Sunday late, still this week locally
      ["instagram", at(4, "15:00"), "failed"],
      ["tiktok", at(7, "00:30"), "published"], // next Monday: not last week
    ];
    for (const [platform, scheduledFor, status] of rows) {
      await client.query(`insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status) values ($1, $2, $3, 'c', $4, $5)`, [batch, media, platform, scheduledFor, status]);
    }
  });

  afterAll(async () => {
    if (client) {
      await client.query("rollback");
      client.release();
    }
    await pool?.end();
  });

  it("one page-only report-ready for a week with published items; none on re-run", async () => {
    const r = await runWeeklyReportOnce(client, { timeZone: TZ, now: mondayAfter(WEEK), log: () => {} });
    expect(r).toEqual({ weekStart: WEEK, published: 3, alertRaised: true });
    expect(await reports(WEEK)).toEqual([{ message: reportReadyMessage(WEEK, 3), platform: "all", batch_item_id: null }]);
    const again = await runWeeklyReportOnce(client, { timeZone: TZ, now: new Date(mondayAfter(WEEK).getTime() + 3_600_000), log: () => {} });
    expect(again.alertRaised).toBe(false);
    expect(await reports(WEEK)).toHaveLength(1);
  });

  it("none for an empty week, none without TZ_CREATOR", async () => {
    const r = await runWeeklyReportOnce(client, { timeZone: TZ, now: mondayAfter(EMPTY_WEEK), log: () => {} });
    expect(r).toEqual({ weekStart: EMPTY_WEEK, published: 0, alertRaised: false });
    expect(await reports(EMPTY_WEEK)).toHaveLength(0);
    const before = (await client.query(`select count(*)::int as n from alerts`)).rows[0].n;
    expect(await runWeeklyReportOnce(client, { timeZone: undefined, now: mondayAfter(WEEK), log: () => {} })).toEqual({ weekStart: null, published: 0, alertRaised: false });
    expect((await client.query(`select count(*)::int as n from alerts`)).rows[0].n).toBe(before);
  });
});
