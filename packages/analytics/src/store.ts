import type { PublishedPost, SnapshotWrite } from "./ingest.js";
import { EMPTY_METRICS, type Metrics, type PostRecord } from "./types.js";

export interface QueryPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function normalizeMetrics(raw: unknown): Metrics {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    views: num(r.views),
    reach: num(r.reach),
    likes: num(r.likes),
    comments: num(r.comments),
    saves: num(r.saves),
    shares: num(r.shares),
    avgWatchTime: num(r.avgWatchTime),
    skipRate: num(r.skipRate),
  };
}

/**
 * Published posts with their latest snapshot. Trial status comes from batch_items.trial:
 * a trial counts only if it published as one (`fellBack` not true) — how the outbox records the
 * plain-reel fallback is an assumption to confirm when IG publishing lands (needsAttention).
 */
export async function loadPostRecords(pool: QueryPool, since: Date): Promise<PostRecord[]> {
  const { rows } = await pool.query(
    `select bi.id, bi.media_id, bi.platform, bi.caption, bi.scheduled_for, bi.trial, m.pillar, m.duration_s,
            pm.metrics, pm.captured_at
       from batch_items bi
       join media m on m.id = bi.media_id
       left join lateral (
         select metrics, captured_at from post_metrics where batch_item_id = bi.id order by captured_at desc limit 1
       ) pm on true
      where bi.status = 'published' and bi.scheduled_for >= $1
      order by bi.scheduled_for`,
    [since.toISOString()],
  );
  return rows.map((r): PostRecord => {
    const trial = (r.trial ?? null) as { fellBack?: boolean; sharedAt?: string } | null;
    return {
      batchItemId: r.id,
      mediaId: r.media_id ?? undefined,
      platform: r.platform,
      pillar: r.pillar ?? null,
      caption: r.caption ?? "",
      durationS: num(r.duration_s),
      postedAt: iso(r.scheduled_for)!,
      isTrial: r.platform === "instagram" && trial !== null && trial.fellBack !== true,
      trialSharedAt: trial?.sharedAt ?? null,
      metrics: r.metrics ? normalizeMetrics(r.metrics) : { ...EMPTY_METRICS },
      capturedAt: iso(r.captured_at),
    };
  });
}

export async function loadPublishedForIngest(pool: QueryPool, since: Date): Promise<PublishedPost[]> {
  const { rows } = await pool.query(
    `select bi.id, bi.platform, bi.platform_post_id, bi.scheduled_for,
            coalesce(array_agg(pm.age_hours) filter (where pm.age_hours is not null), '{}') as ages
       from batch_items bi left join post_metrics pm on pm.batch_item_id = bi.id
      where bi.status = 'published' and bi.platform_post_id is not null and bi.scheduled_for >= $1
      group by bi.id`,
    [since.toISOString()],
  );
  return rows.map((r) => ({
    batchItemId: r.id,
    platform: r.platform,
    platformPostId: r.platform_post_id,
    postedAt: iso(r.scheduled_for)!,
    capturedAges: (r.ages ?? []).map(Number),
  }));
}

export async function writeSnapshot(pool: QueryPool, w: SnapshotWrite): Promise<void> {
  await pool.query(
    `insert into post_metrics (batch_item_id, age_hours, metrics) values ($1, $2, $3)
     on conflict (batch_item_id, age_hours) do nothing`,
    [w.batchItemId, w.ageHours, JSON.stringify(w.metrics)],
  );
}
