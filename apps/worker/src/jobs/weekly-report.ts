import { addCalendarDays, localDate, localToUtc, weekdayIndex } from "@autopilot/core";
import { QUEUES } from "../queue.js";
import type { CronBoss, Queryable } from "./weekly-draft.js";

/**
 * F14 Monday `weekly-report` (docs/design/F14.md): when anything was published in the week that just
 * finished (creator-local Monday 00:00 to Monday 00:00), raise one page-only 'report-ready' alert that
 * links to /analytics?days=7 (the link lives in apps/web/lib/alerts/view.ts). No LLM, no storage, no
 * platform call: one count and one insert, so it runs in dry-run too.
 */
export const WEEKLY_REPORT_CRON = "0 8 * * 1"; // Monday 08:00 in TZ_CREATOR (pg-boss `tz`)
export const WEEKLY_REPORT_NO_TZ_LINE = "[weekly-report] TZ_CREATOR not set: weekly-report not scheduled";

/** The creator-local Monday of the last full week before `now` (on a Monday: the Monday 7 days ago). */
export function lastWeekStart(now: Date, timeZone: string): string {
  const today = localDate(now, timeZone);
  return addCalendarDays(today, -weekdayIndex(today) - 7);
}

/** Counts and the week date only. */
export function reportReadyMessage(weekStart: string, published: number): string {
  return `Last week's report is ready (from ${weekStart}): ${published} post${published === 1 ? "" : "s"} published`;
}

export interface WeeklyReportResult {
  weekStart: string | null;
  published: number;
  alertRaised: boolean;
}

export async function runWeeklyReportOnce(db: Queryable, opts: { timeZone: string | undefined; now?: Date; log?: (l: string) => void }): Promise<WeeklyReportResult> {
  const log = opts.log ?? console.log;
  if (!opts.timeZone) {
    log(WEEKLY_REPORT_NO_TZ_LINE);
    return { weekStart: null, published: 0, alertRaised: false };
  }
  const now = opts.now ?? new Date();
  const weekStart = lastWeekStart(now, opts.timeZone);
  const from = localToUtc(weekStart, "00:00", opts.timeZone);
  const to = localToUtc(addCalendarDays(weekStart, 7), "00:00", opts.timeZone);
  const { rows } = await db.query(
    `select count(*)::int as n from batch_items where status = 'published' and scheduled_for >= $1::timestamptz and scheduled_for < $2::timestamptz`,
    [from.toISOString(), to.toISOString()],
  );
  const published = Number(rows[0]?.n ?? 0);
  let alertRaised = false;
  if (published > 0) {
    const message = reportReadyMessage(weekStart, published);
    const ins = await db.query(
      `insert into alerts (kind, batch_item_id, platform, message, created_at)
       select 'report-ready', null, 'all', $1, $2
        where not exists (select 1 from alerts where kind = 'report-ready' and message = $1)
       returning id`,
      [message, now],
    );
    alertRaised = ins.rows.length === 1;
  }
  log(`[weekly-report] week ${weekStart}: published ${published} · alert ${alertRaised ? "raised" : "none"}`);
  return { weekStart, published, alertRaised };
}

/** Monday 08:00 creator-local. No TZ_CREATOR → one log line, nothing registered. */
export async function registerWeeklyReportJob(boss: CronBoss, pool: Queryable, timeZone: string | undefined, log: (l: string) => void = console.log): Promise<boolean> {
  if (!timeZone) {
    log(WEEKLY_REPORT_NO_TZ_LINE);
    return false;
  }
  await boss.createQueue(QUEUES.weeklyReport);
  await boss.work(QUEUES.weeklyReport, async () => {
    await runWeeklyReportOnce(pool, { timeZone, log });
  });
  await boss.schedule(QUEUES.weeklyReport, WEEKLY_REPORT_CRON, {}, { tz: timeZone });
  return true;
}
