import type { Platform } from "@autopilot/core";
import type { MatchCandidate, MatchResult } from "./account-match.js";
import type { AccountDailyRow, AccountMetrics, AccountPostRecord, AccountSnapshotRow, AccountTotals, FetchedAccountPost, MatchedBy } from "./account-types.js";
import type { QueryPool } from "./store.js";

/** SQL for 0011_account_posts.sql. Every write is an upsert or insert-or-nothing: re-runs add no duplicates. */

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const ymd = (v: unknown) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : String(v).slice(0, 10));

/** Published app items (with or without a post id) that an account post could belong to. */
export async function loadMatchCandidates(pool: QueryPool, platform: Platform, since: Date): Promise<MatchCandidate[]> {
  const { rows } = await pool.query(
    `select id, platform, platform_post_id, caption, title, scheduled_for from batch_items
      where platform = $1 and status = 'published' and scheduled_for >= $2`,
    [platform, since.toISOString()],
  );
  return rows.map((r) => ({
    batchItemId: r.id,
    platform: r.platform,
    platformPostId: r.platform_post_id ?? null,
    caption: r.caption ?? null,
    title: r.title ?? null,
    scheduledFor: iso(r.scheduled_for)!,
  }));
}

export async function loadExistingMatches(pool: QueryPool, platform: Platform, ids: string[]): Promise<Map<string, MatchResult>> {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(`select platform_post_id, batch_item_id, matched_by from account_posts where platform = $1 and platform_post_id = any($2::text[])`, [platform, ids]);
  return new Map(rows.map((r) => [r.platform_post_id as string, { batchItemId: r.batch_item_id ?? null, matchedBy: (r.matched_by ?? null) as MatchedBy | null }]));
}

/**
 * Upsert by (platform, platform_post_id). The match only moves up: an 'id' match is never replaced, and
 * a null match never clears an earlier one. Returns the row id.
 */
export async function upsertAccountPost(pool: QueryPool, platform: Platform, p: FetchedAccountPost, m: MatchResult, now: Date): Promise<string> {
  const { rows } = await pool.query(
    `insert into account_posts (platform, platform_post_id, permalink, kind, caption, title, published_at, duration_s, batch_item_id, matched_by, first_seen_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     on conflict (platform, platform_post_id) do update set
       permalink = excluded.permalink,
       kind = coalesce(excluded.kind, account_posts.kind),
       caption = excluded.caption,
       title = excluded.title,
       published_at = excluded.published_at,
       duration_s = coalesce(excluded.duration_s, account_posts.duration_s),
       batch_item_id = case when account_posts.matched_by = 'id' then account_posts.batch_item_id
                            when excluded.matched_by = 'id' then excluded.batch_item_id
                            else coalesce(account_posts.batch_item_id, excluded.batch_item_id) end,
       matched_by = case when account_posts.matched_by = 'id' then 'id'
                         when excluded.matched_by = 'id' then 'id'
                         else coalesce(account_posts.matched_by, excluded.matched_by) end,
       updated_at = excluded.updated_at
     returning id`,
    [platform, p.platformPostId, p.permalink, p.kind, p.caption, p.title, p.publishedAt, p.durationS, m.batchItemId, m.matchedBy, now.toISOString()],
  );
  return rows[0].id as string;
}

/** One snapshot per post per run (pk post + captured_at): the same run twice is a no-op. */
export async function insertAccountSnapshot(pool: QueryPool, accountPostId: string, capturedAt: Date, m: AccountMetrics): Promise<boolean> {
  const { rows } = await pool.query(
    `insert into account_post_snapshots (account_post_id, captured_at, views, likes, comments, shares, saves, reach, avg_watch_s)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict do nothing returning account_post_id`,
    [accountPostId, capturedAt.toISOString(), m.views, m.likes, m.comments, m.shares, m.saves, m.reach, m.avgWatchS],
  );
  return rows.length === 1;
}

export async function hasAccountSnapshot(pool: QueryPool, platform: Platform, day: string): Promise<boolean> {
  const { rows } = await pool.query(`select 1 from account_snapshots where platform = $1 and captured_on = $2::date`, [platform, day]);
  return rows.length > 0;
}

export async function upsertAccountSnapshot(pool: QueryPool, platform: Platform, day: string, t: AccountTotals): Promise<void> {
  await pool.query(
    `insert into account_snapshots (platform, captured_on, followers, total_views, posts_count) values ($1, $2::date, $3, $4, $5)
     on conflict (platform, captured_on) do update set
       followers = coalesce(excluded.followers, account_snapshots.followers),
       total_views = coalesce(excluded.total_views, account_snapshots.total_views),
       posts_count = coalesce(excluded.posts_count, account_snapshots.posts_count)`,
    [platform, day, t.followers, t.totalViews, t.postsCount],
  );
}

// ---------------------------------------------------------------- readers (report + web)

/**
 * Account posts published at or after `since` (and before `until`, if given) with their latest snapshot
 * that has a views number (else the latest one), plus the matched clip's pillar/duration.
 */
export async function loadAccountPosts(pool: QueryPool, opts: { since: Date; until?: Date; platform?: Platform }): Promise<AccountPostRecord[]> {
  const { rows } = await pool.query(
    `select ap.id, ap.platform, ap.platform_post_id, ap.permalink, ap.kind, ap.caption, ap.title, ap.published_at,
            coalesce(ap.duration_s, m.duration_s) as duration_s, ap.batch_item_id, ap.matched_by, bi.media_id, m.pillar,
            s.captured_at, s.views, s.likes, s.comments, s.shares, s.saves, s.reach, s.avg_watch_s
       from account_posts ap
       left join batch_items bi on bi.id = ap.batch_item_id
       left join media m on m.id = bi.media_id
       left join lateral (
         select * from account_post_snapshots x where x.account_post_id = ap.id
          order by (x.views is null), x.captured_at desc limit 1
       ) s on true
      where ap.published_at >= $1 and ($2::timestamptz is null or ap.published_at < $2) and ($3::text is null or ap.platform = $3)
      order by ap.published_at, ap.id`,
    [opts.since.toISOString(), opts.until?.toISOString() ?? null, opts.platform ?? null],
  );
  return rows.map((r): AccountPostRecord => ({
    id: r.id,
    platform: r.platform,
    platformPostId: r.platform_post_id,
    permalink: r.permalink,
    kind: r.kind ?? null,
    caption: r.caption ?? null,
    title: r.title ?? null,
    publishedAt: iso(r.published_at)!,
    durationS: num(r.duration_s),
    batchItemId: r.batch_item_id ?? null,
    mediaId: r.batch_item_id ? (r.media_id ?? null) : null,
    matchedBy: (r.matched_by ?? null) as MatchedBy | null,
    pillar: r.batch_item_id ? (r.pillar ?? null) : null,
    metrics: r.captured_at
      ? { views: num(r.views), likes: num(r.likes), comments: num(r.comments), shares: num(r.shares), saves: num(r.saves), reach: num(r.reach), avgWatchS: num(r.avg_watch_s) }
      : null,
    capturedAt: iso(r.captured_at),
  }));
}

/** Every snapshot (views only) for posts published at or after `since`: the input of viewGainsByDay. */
export async function loadAccountSnapshotViews(pool: QueryPool, opts: { since: Date; platform?: Platform }): Promise<AccountSnapshotRow[]> {
  const { rows } = await pool.query(
    `select s.account_post_id, s.captured_at, s.views from account_post_snapshots s join account_posts ap on ap.id = s.account_post_id
      where ap.published_at >= $1 and ($2::text is null or ap.platform = $2) order by s.account_post_id, s.captured_at`,
    [opts.since.toISOString(), opts.platform ?? null],
  );
  return rows.map((r) => ({ accountPostId: r.account_post_id, capturedAt: iso(r.captured_at)!, views: num(r.views) }));
}

/** Daily account rows from `fromDay` (YYYY-MM-DD) on; plus the latest row before it per platform (the baseline). */
export async function loadAccountDaily(pool: QueryPool, opts: { fromDay: string; platform?: Platform }): Promise<AccountDailyRow[]> {
  const { rows } = await pool.query(
    `select platform, captured_on, followers, total_views, posts_count from account_snapshots
      where ($2::text is null or platform = $2) and (
        captured_on >= $1::date
        or captured_on = (select max(captured_on) from account_snapshots y where y.platform = account_snapshots.platform and y.captured_on < $1::date))
      order by platform, captured_on`,
    [opts.fromDay, opts.platform ?? null],
  );
  return rows.map((r) => ({ platform: r.platform, capturedOn: ymd(r.captured_on), followers: num(r.followers), totalViews: num(r.total_views), postsCount: num(r.posts_count) }));
}
