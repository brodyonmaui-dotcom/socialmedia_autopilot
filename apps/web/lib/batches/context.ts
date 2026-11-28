import type { Pool } from "pg";
import { assertTimeZone, type Platform } from "@autopilot/core";
import { loadCadence } from "@autopilot/db";
import { blocklistFromEnv } from "@autopilot/research";
import type { WarningContext } from "./warnings.js";

export interface BatchContextInput {
  pool: Pool;
  weekStart: string;
  batchId: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

/** Server-side: everything computeWarnings needs for one batch. TZ_CREATOR comes from .env; UTC is a flagged fallback. */
export async function loadWarningContext(i: BatchContextInput): Promise<WarningContext & { timeZoneSource: "env" | "fallback" }> {
  const env = i.env ?? process.env;
  const cadence = await loadCadence(i.pool);

  let timeZone = "UTC";
  let timeZoneSource: "env" | "fallback" = "fallback";
  if (env.TZ_CREATOR) {
    try {
      timeZone = assertTimeZone(env.TZ_CREATOR);
      timeZoneSource = "env";
    } catch {
      // invalid zone: keep the UTC fallback, the page says so
    }
  }

  const { rows } = await i.pool.query(
    `select platform, scheduled_for from batch_items
      where batch_id <> $1 and scheduled_for is not null and status not in ('failed', 'rejected')
        and scheduled_for between ($2::date - interval '2 days') and ($2::date + interval '9 days')`,
    [i.batchId, i.weekStart],
  );
  const existing = rows.map((r) => ({
    platform: r.platform as Platform,
    scheduledFor: (r.scheduled_for instanceof Date ? r.scheduled_for : new Date(r.scheduled_for)).toISOString(),
  }));

  // F26 judge: captions of other posts in the 30 days around this week (any batch), for repeat/hashtag-set checks.
  const recent = await i.pool.query(
    `select id, platform, caption from batch_items
      where batch_id <> $1 and status not in ('failed', 'rejected') and caption <> ''
        and coalesce(scheduled_for, created_at) between ($2::date - interval '30 days') and ($2::date + interval '9 days')`,
    [i.batchId, i.weekStart],
  );
  const recentPosts = recent.rows.map((r) => ({ id: String(r.id), platform: r.platform as Platform, caption: String(r.caption) }));

  return { now: i.now ?? new Date(), cadence, timeZone, timeZoneSource, existing, blocklist: blocklistFromEnv(env), recentPosts };
}
