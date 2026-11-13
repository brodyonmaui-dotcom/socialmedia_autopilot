import {
  runOutboxTick,
  sanitizeForLog,
  type AlertSink,
  type OutboxAlert,
  type OutboxPost,
  type OutboxStore,
  type Platform,
  type PlatformAdapter,
  type PublishResult,
  type RetryPolicy,
  type TickResult,
} from "@autopilot/core";
import { buildAdapters, type AdapterCredentials } from "@autopilot/adapters";
import { loadCadence } from "@autopilot/db";
import { blocklistFromEnv, lintText } from "@autopilot/research";

/** Only what the store needs from pg.Pool, so tests pass a recording fake (same pattern as db/settings.ts). */
export interface OutboxPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface OutboxConfig {
  /** Platform credentials; only configured platforms get an adapter (see credentialsFromEnv). */
  credentials?: AdapterCredentials;
  publicMediaBase: string;
  dryRun: boolean;
  /** TZ_CREATOR. Required for a live run; a dry run without it falls back to UTC day boundaries and says so. */
  timeZone?: string;
  policy?: RetryPolicy;
  alerts?: AlertSink;
  log?: (line: string) => void;
  /** PRIVACY_BLOCKLIST terms for the publish-time privacy lint (default: blocklistFromEnv()). */
  blocklist?: string[];
}

interface Row {
  id: string;
  idempotency_key: string;
  media_id: string;
  platform: Platform;
  caption: string;
  title: string | null;
  trial: { tiktokDraft?: boolean; graduationStrategy?: "MANUAL" | "SS_PERFORMANCE"; graduation_strategy?: "MANUAL" | "SS_PERFORMANCE" } | null;
  scheduled_for: string | Date;
  status: OutboxPost["status"];
  attempts: number;
  next_attempt_at: string | Date | null;
  last_error: string | null;
  platform_post_id: string | null;
  platform_post_url: string | null;
  updated_at: string | Date;
  r2_key: string | null;
}

const iso = (v: string | Date | null | undefined): string | undefined => (v == null ? undefined : new Date(v).toISOString());

const SELECT = `select bi.id, bi.idempotency_key, bi.media_id, bi.platform, bi.caption, bi.title, bi.trial, bi.scheduled_for, bi.status,
  bi.attempts, bi.next_attempt_at, bi.last_error, bi.platform_post_id, bi.platform_post_url, bi.updated_at, m.r2_key
  from batch_items bi join media m on m.id = bi.media_id`;

/**
 * OutboxStore over batch_items. Rules the SQL enforces:
 *  - listDue() only returns items with approved_at set whose batch has status 'approved';
 *  - claim() is a conditional update (status in approved/queued), so two ticks can't both fire a row;
 *  - every status write bumps updated_at, which is how a crashed "publishing" row gets noticed;
 *  - alerts are unique per (kind, item), so recordAlert() reports whether the alert is new;
 *  - (F7 A11) an item whose media has no r2_key (no clean file) is never fired: listDue excludes it in
 *    SQL, and the mapping drops such a row with a log line as a second guard, instead of publishing
 *    the bare PUBLIC_MEDIA_BASE URL. A stale "publishing" row still maps (recovery only looks it up);
 *  - (F7 B2/B3) last_error and alert messages are written through sanitizeForLog.
 */
export class PgOutboxStore implements OutboxStore {
  constructor(
    private readonly pool: OutboxPool,
    private readonly publicMediaBase: string,
    private readonly log: (line: string) => void = (line) => console.log(line),
  ) {}

  /** Null when the row has no media file to send (A11): such a row must never reach an adapter. */
  toDuePost(r: Row): OutboxPost | null {
    if (!r.r2_key) {
      this.log(`[outbox] skipping item ${r.id}: its media has no clean file (r2_key is null); not fired`);
      return null;
    }
    return this.toPost(r);
  }

  private toPost(r: Row): OutboxPost {
    return {
      id: r.id,
      idempotencyKey: r.idempotency_key,
      platform: r.platform,
      mediaUrl: `${this.publicMediaBase}/${r.r2_key ?? ""}`,
      caption: r.caption,
      title: r.title ?? undefined,
      scheduledFor: iso(r.scheduled_for)!,
      status: r.status,
      attempts: r.attempts,
      nextAttemptAt: iso(r.next_attempt_at),
      updatedAt: iso(r.updated_at),
      lastError: r.last_error ?? undefined,
      platformPostId: r.platform_post_id ?? undefined,
      platformPostUrl: r.platform_post_url ?? undefined,
      mediaId: r.media_id,
      tiktokDraft: r.trial?.tiktokDraft === true,
      trial: r.platform === "instagram" && (r.trial?.graduationStrategy ?? r.trial?.graduation_strategy) ? { graduationStrategy: (r.trial.graduationStrategy ?? r.trial.graduation_strategy)! } : undefined,
    };
  }

  async listDue(now: Date): Promise<OutboxPost[]> {
    const { rows } = await this.pool.query(
      // Approval gate (F2): only items stamped approved, in a batch that is itself approved, ever fire.
      `${SELECT} join batches b on b.id = bi.batch_id
       where b.status = 'approved' and bi.approved_at is not null and m.r2_key is not null
         and (bi.status = 'approved' or (bi.status = 'queued' and (bi.next_attempt_at is null or bi.next_attempt_at <= $1)))
       order by bi.scheduled_for asc`,
      [now.toISOString()],
    );
    return (rows as Row[]).map((r) => this.toDuePost(r)).filter((p): p is OutboxPost => p !== null);
  }

  async listStale(before: Date): Promise<OutboxPost[]> {
    const { rows } = await this.pool.query(`${SELECT} where bi.status = 'publishing' and bi.updated_at < $1 order by bi.updated_at asc`, [before.toISOString()]);
    return (rows as Row[]).map((r) => this.toPost(r));
  }

  async claim(postId: string, now: Date): Promise<boolean> {
    const { rows } = await this.pool.query(
      `update batch_items set status = 'publishing', next_attempt_at = null, updated_at = $2
       where id = $1 and status in ('approved', 'queued') returning id`,
      [postId, now.toISOString()],
    );
    return rows.length === 1;
  }

  async markPublished(postId: string, result: PublishResult, attempts: number, now: Date): Promise<void> {
    // trial.fellBack=true is what packages/analytics reads to tell a real trial from a fallback reel.
    const patch: Record<string, unknown> = {};
    if (result.trialFellBack) patch.fellBack = true;
    if (result.flags?.length) patch.flags = result.flags;
    await this.pool.query(
      `update batch_items set status = 'published', platform_post_id = $2, platform_post_url = $3, attempts = $4, next_attempt_at = null, last_error = null, updated_at = $5,
         trial = case when $6::jsonb = '{}'::jsonb then trial else coalesce(trial, '{}'::jsonb) || $6::jsonb end
       where id = $1`,
      [postId, result.platformPostId, result.platformPostUrl ?? null, attempts, now.toISOString(), JSON.stringify(patch)],
    );
  }

  async markQueued(postId: string, attempts: number, nextAttemptAt: string, error: string, now: Date): Promise<void> {
    await this.pool.query(`update batch_items set status = 'queued', attempts = $2, next_attempt_at = $3, last_error = $4, updated_at = $5 where id = $1`, [
      postId,
      attempts,
      nextAttemptAt,
      sanitizeForLog(error),
      now.toISOString(),
    ]);
  }

  async markFailed(postId: string, attempts: number, error: string, now: Date): Promise<void> {
    await this.pool.query(`update batch_items set status = 'failed', attempts = $2, next_attempt_at = null, last_error = $3, updated_at = $4 where id = $1`, [postId, attempts, sanitizeForLog(error), now.toISOString()]);
  }

  async markUnknown(postId: string, attempts: number, error: string, now: Date): Promise<void> {
    await this.pool.query(`update batch_items set status = 'unknown', attempts = $2, next_attempt_at = null, last_error = $3, updated_at = $4 where id = $1`, [postId, attempts, sanitizeForLog(error), now.toISOString()]);
  }

  async countSentOn(platform: Platform, localDay: string, timeZone: string): Promise<number> {
    // Postgres resolves the creator's calendar day from the IANA zone passed in (never stored).
    const { rows } = await this.pool.query(
      `select count(*)::int as n from batch_items
       where platform = $1 and status in ('published', 'publishing', 'unknown') and (scheduled_for at time zone $3)::date = $2::date`,
      [platform, localDay, timeZone],
    );
    return (rows[0]?.n as number | undefined) ?? 0;
  }

  async recordAlert(alert: OutboxAlert): Promise<boolean> {
    const { rows } = await this.pool.query(
      `insert into alerts (kind, batch_item_id, platform, message, created_at) values ($1, $2, $3, $4, $5)
       on conflict (kind, batch_item_id) do nothing returning id`,
      [alert.kind, alert.postId, alert.platform, sanitizeForLog(alert.message), alert.at],
    );
    return rows.length === 1;
  }
}

/** Moved to @autopilot/db (the web app needs it too); re-exported so scripts/schedule-batch.ts keeps working. */
export { loadCadence } from "@autopilot/db";

/** Console sink; the alert is already in the alerts table for the dashboard. PWA push arrives with F4. */
export const consoleAlertSink: AlertSink = {
  async send(alert) {
    console.log(sanitizeForLog(`[alert] ${alert.kind} ${alert.platform} item ${alert.postId}: ${alert.message}`));
  },
};

/**
 * F7 C5: last-line privacy check on what is about to go public (caption, and the YouTube title).
 * Only the privacy.* error rules apply here: tone/hashtag rules were the skill's and approval's job,
 * and a style nit must not block a scheduled post. Returns the refusal reason, or null.
 */
export function privacyCaptionGuard(blocklist: string[]): (post: OutboxPost) => string | null {
  return (post) => {
    const texts: Array<[string, "caption" | "title"]> = [[post.caption ?? "", "caption"]];
    if (post.title) texts.push([post.title, "title"]);
    const rules = new Set<string>();
    for (const [text, kind] of texts) {
      for (const i of lintText({ text, kind, platform: post.platform, blocklist }).issues) {
        if (i.severity === "error" && i.rule.startsWith("privacy.")) rules.add(i.rule);
      }
    }
    return rules.size ? `caption failed privacy lint: ${[...rules].join(", ")}` : null;
  };
}

/**
 * One outbox tick against Postgres with the real adapters (only those configured). YouTube and TikTok
 * hold their own clock once handed off, so they go out ahead of scheduled_for; Instagram fires at it.
 */
export async function runOutboxOnce(pool: OutboxPool, cfg: OutboxConfig): Promise<TickResult> {
  return runOutboxWith(pool, buildAdapters(cfg.credentials ?? {}), cfg);
}

/** Separated from runOutboxOnce so tests can inject fake adapters instead of hitting real APIs. */
export async function runOutboxWith(pool: OutboxPool, adapters: Partial<Record<Platform, PlatformAdapter>>, cfg: OutboxConfig): Promise<TickResult> {
  const log = cfg.log ?? ((line: string) => console.log(sanitizeForLog(line)));
  if (!cfg.timeZone && !cfg.dryRun) throw new Error("TZ_CREATOR is required for a live outbox run (daily caps are per creator-local day)");
  const timeZone = cfg.timeZone ?? "UTC";
  const cadence = await loadCadence(pool);
  const store = new PgOutboxStore(pool, cfg.publicMediaBase, log);
  const captionGuard = privacyCaptionGuard(cfg.blocklist ?? blocklistFromEnv());
  return runOutboxTick(store, { adapters, dryRun: cfg.dryRun, policy: cfg.policy, cadence, timeZone, alerts: cfg.alerts ?? consoleAlertSink, log, captionGuard });
}
