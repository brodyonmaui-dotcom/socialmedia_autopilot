// Server only: the /platforms/[platform] read path. Composes existing loaders (cadence, calendar, engagement
// settings, analytics overview) plus two small reads (today's counts, the newest open token-health alert).
// Read-only: nothing here writes.
import type { Pool } from "pg";
import { addCalendarDays, localDate, localToUtc, type Platform } from "@autopilot/core";
import { loadCadence } from "@autopilot/db";
import { loadOverview, type PlatformCard } from "../analytics/overview.js";
import { creatorZone, loadCalendar } from "../calendar/load.js";
import { loadEngagement } from "../engagement/settings.js";
import { tokenService, upcomingFor, type TodayCounts, type TokenAlert, type UpcomingRow } from "./view.js";
import type { EngagementPlatform, EngagementSettings } from "@autopilot/engagement";
import { ENGAGEMENT_STATUS_KEY, parseEngagementStatus, type PlatformReplyStatus } from "@autopilot/engagement/src/status.js";
import { getSetting } from "@autopilot/db";

/** How far ahead "next posts" looks (the calendar loader works per window; 6 weeks covers any planned week). */
export const UPCOMING_DAYS = 42;
/** Analytics window for the tiles (same as the analytics page's default range). */
export const ANALYTICS_DAYS = 30 as const;

export const PLATFORM_SQL = {
  // Same statuses the outbox counts against the cap (countSentOn), plus what is still planned for today.
  today: `select status, count(*)::int as n from batch_items
           where platform = $1 and scheduled_for >= $2 and scheduled_for < $3 and status in ('approved', 'queued', 'publishing', 'published', 'unknown')
           group by status`,
  // Snapchat: marked posted during the creator-local today (the handoff's own 1-a-day count).
  snapShared: `select count(*)::int as n from batch_items where platform = 'snapchat' and status = 'published' and updated_at >= $1 and updated_at < $2`,
  token: `select message, created_at from alerts where kind = 'token-health' and platform = $1 and acknowledged_at is null order by created_at desc limit 1`,
} as const;

export interface PlatformPageData {
  platform: Platform;
  timeZone: string;
  /** false = TZ_CREATOR unset or invalid: "today" is counted in UTC (the page says so). */
  zoneSet: boolean;
  today: string;
  cap: number;
  counts: TodayCounts;
  token: TokenAlert | null;
  engagement: EngagementSettings;
  killEnv: boolean;
  /** The worker's reply report for this platform (null: Snapchat, or the worker hasn't ticked yet). */
  replyStatus: PlatformReplyStatus | null;
  upcoming: UpcomingRow[];
  analytics: PlatformCard | null;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/** Today's counts for one platform in the creator-local day (`sent` = published + publishing + unknown, as the outbox caps). */
export async function loadTodayCounts(pool: Pick<Pool, "query">, p: Platform, today: string, timeZone: string): Promise<TodayCounts> {
  const from = localToUtc(today, "00:00", timeZone);
  const to = localToUtc(addCalendarDays(today, 1), "00:00", timeZone);
  if (p === "snapchat") {
    // Snapchat items are marked posted by hand: count by when they were marked, like the handoff did.
    const [shared, planned] = await Promise.all([pool.query(PLATFORM_SQL.snapShared, [from, to]), pool.query(PLATFORM_SQL.today, [p, from, to])]);
    const plannedN = (planned.rows as Array<{ status: string; n: number }>).filter((r) => r.status === "approved" || r.status === "queued").reduce((s, r) => s + r.n, 0);
    return { sent: (shared.rows[0]?.n as number | undefined) ?? 0, planned: plannedN };
  }
  const { rows } = await pool.query(PLATFORM_SQL.today, [p, from, to]);
  let sent = 0;
  let planned = 0;
  for (const r of rows as Array<{ status: string; n: number }>) {
    if (r.status === "published" || r.status === "publishing" || r.status === "unknown") sent += r.n;
    else planned += r.n;
  }
  return { sent, planned };
}

export async function loadTokenAlert(pool: Pick<Pool, "query">, p: Platform): Promise<TokenAlert | null> {
  const service = tokenService(p);
  if (!service) return null;
  const { rows } = await pool.query(PLATFORM_SQL.token, [service]);
  const r = rows[0] as { message: string; created_at: unknown } | undefined;
  return r ? { message: String(r.message ?? ""), createdAt: iso(r.created_at) } : null;
}

export async function loadPlatformPage(pool: Pool, p: Platform, now: Date, env: NodeJS.ProcessEnv = process.env): Promise<PlatformPageData> {
  const { timeZone, source } = creatorZone(env);
  const today = localDate(now, timeZone);
  const kill = (env.ENGAGEMENT_KILL ?? "").trim().toLowerCase();
  const [cadence, counts, token, engagement, calendar, overview, rawStatus] = await Promise.all([
    loadCadence(pool),
    loadTodayCounts(pool, p, today, timeZone),
    loadTokenAlert(pool, p),
    loadEngagement(pool),
    loadCalendar(pool, { from: today, to: addCalendarDays(today, UPCOMING_DAYS), now }),
    loadOverview(pool, { days: ANALYTICS_DAYS, timeZone, now }),
    getSetting<unknown>(pool, ENGAGEMENT_STATUS_KEY),
  ]);
  return {
    platform: p,
    timeZone,
    zoneSet: source === "env",
    today,
    cap: cadence.dailyCaps[p],
    counts,
    token,
    engagement,
    killEnv: kill === "1" || kill === "true",
    replyStatus: p === "snapchat" ? null : (parseEngagementStatus(rawStatus)?.platforms[p as EngagementPlatform] ?? null),
    upcoming: upcomingFor(calendar.entries, p, now, today),
    analytics: overview.platforms.find((c) => c.platform === p) ?? null,
  };
}
