// Postgres EngagementStore (F3) over migration 0007. Same discipline as PgOutboxStore: conditional
// claims, every status write bumps updated_at, alerts deduped. Also the extra reads/writes the
// poll/triage/DM jobs need (comments, triage rows, cursors, DM threads + drafts). Nothing here sends.

import {
  normalizeEngagement,
  type ActionKind,
  type ActionStatus,
  type EngagementActionRow,
  type EngagementAlert,
  type EngagementLimits,
  type EngagementPlatform,
  type EngagementSettings,
  type EngagementStore,
  type DmThreadInput,
  type InboundComment,
  type LimitCounts,
  type TriageContext,
  type TriageResult,
} from "@autopilot/engagement";
import { getSetting, setSetting } from "@autopilot/db";
import type { OutboxPool } from "./outbox.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Alerts with the same kind and the same first 80 chars of message count as one while unacknowledged. */
export const ALERT_DEDUPE_PREFIX = 80;

const iso = (v: string | Date | null | undefined): string | null => (v == null ? null : new Date(v).toISOString());

/** An untriaged comment as the triage job sees it. */
export interface UntriagedComment {
  id: string;
  comment: InboundComment;
  ctx: TriageContext;
}

export interface CursorRow {
  cursor: unknown;
  polledAt: Date | null;
}

export interface UpsertedDmThread {
  threadId: string;
  thread: DmThreadInput;
}

/** What the jobs need beyond the send-tick surface. Implemented by PgEngagementStore (and fakes in tests). */
export interface EngagementJobStore extends EngagementStore {
  loadSettings(): Promise<EngagementSettings>;
  upsertComments(comments: InboundComment[], now: Date): Promise<number>;
  listUntriaged(limit: number): Promise<UntriagedComment[]>;
  saveTriage(commentId: string, result: TriageResult, now: Date): Promise<void>;
  insertAction(commentId: string, kind: ActionKind, text: string | null, status: "planned" | "shadow", notBefore: Date | string, now: Date): Promise<boolean>;
  getCursor(platform: string): Promise<CursorRow | null>;
  setCursor(platform: string, cursor: unknown, now: Date): Promise<void>;
  upsertDmThreads(threads: DmThreadInput[], igUserId: string | null, now: Date): Promise<UpsertedDmThread[]>;
  latestDraft(threadId: string): Promise<{ id: string; forPlatformMessageId: string | null } | null>;
  insertDmDraft(threadId: string, forPlatformMessageId: string | null, text: string, bucket: string | null): Promise<void>;
}

interface ActionDbRow {
  id: string;
  comment_id: string;
  platform: EngagementPlatform;
  platform_comment_id: string;
  author_id: string | null;
  kind: ActionKind;
  text: string | null;
  idempotency_key: string;
  status: ActionStatus;
  not_before: string | Date;
  attempts: number;
  next_attempt_at: string | Date | null;
  origin: "auto" | "manual";
  created_at: string | Date;
}

/** sent rows carry sent_at; a row still "sending" is timed by its claim (updated_at). */
const SENT_AT = "coalesce(a.sent_at, a.updated_at)";
const FROM_ACTIONS = "from engagement_actions a join comments c on c.id = a.comment_id";

export class PgEngagementStore implements EngagementJobStore {
  constructor(private readonly pool: OutboxPool) {}

  // ---- settings ----
  async loadSettings(): Promise<EngagementSettings> {
    return normalizeEngagement(await getSetting(this.pool, "engagement"));
  }

  /** Writes only the overlay keys (killed, killedReason) so defaults stay defaults. */
  async setKilled(reason: string, now: Date): Promise<void> {
    void now;
    const raw = await getSetting<unknown>(this.pool, "engagement");
    const overlay = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
    overlay.killed = true;
    overlay.killedReason = reason;
    await setSetting(this.pool, "engagement", overlay);
  }

  // ---- send tick ----
  async listDueActions(now: Date, limit = 20): Promise<EngagementActionRow[]> {
    const { rows } = await this.pool.query(
      `select a.id, a.comment_id, c.platform, c.platform_comment_id, c.author_id, a.kind, a.text, a.idempotency_key, a.status,
              a.not_before, a.attempts, a.next_attempt_at, a.origin, a.created_at
         ${FROM_ACTIONS}
        where a.status = 'planned' and a.not_before <= $1 and (a.next_attempt_at is null or a.next_attempt_at <= $1)
        order by a.not_before limit $2`,
      [now, limit],
    );
    return (rows as ActionDbRow[]).map((r) => ({
      id: r.id,
      commentId: r.comment_id,
      platform: r.platform,
      platformCommentId: r.platform_comment_id,
      authorId: r.author_id,
      kind: r.kind,
      text: r.text,
      idempotencyKey: r.idempotency_key,
      status: r.status,
      notBefore: iso(r.not_before)!,
      attempts: r.attempts,
      nextAttemptAt: iso(r.next_attempt_at),
      origin: r.origin,
      createdAt: iso(r.created_at)!,
    }));
  }

  async claimAction(id: string, now: Date): Promise<boolean> {
    const res = await this.pool.query(
      `update engagement_actions set status = 'sending', updated_at = $2 where id = $1 and status = 'planned' returning id`,
      [id, now],
    );
    return (res.rowCount ?? res.rows.length) === 1;
  }

  async markSent(id: string, platformActionId: string | null, now: Date): Promise<void> {
    await this.pool.query(
      `update engagement_actions set status = 'sent', sent_at = $3, platform_action_id = $2, updated_at = $3,
              attempts = attempts + case when status = 'sending' then 1 else 0 end
        where id = $1`,
      [id, platformActionId, now],
    );
  }

  async markRetry(id: string, nextAttemptAt: Date, error: string, now: Date): Promise<void> {
    await this.pool.query(
      `update engagement_actions set status = 'planned', attempts = attempts + 1, next_attempt_at = $2, last_error = $3, updated_at = $4 where id = $1`,
      [id, nextAttemptAt, error, now],
    );
  }

  async markFailed(id: string, error: string, now: Date): Promise<void> {
    await this.pool.query(
      `update engagement_actions set status = 'failed', attempts = attempts + 1, last_error = $2, updated_at = $3 where id = $1`,
      [id, error, now],
    );
  }

  async markUnknown(id: string, error: string, now: Date): Promise<void> {
    await this.pool.query(
      `update engagement_actions set status = 'unknown', attempts = attempts + 1, last_error = $2, updated_at = $3 where id = $1`,
      [id, error, now],
    );
  }

  async limitCounts(platform: EngagementPlatform, authorId: string | null, limits: EngagementLimits, now: Date): Promise<LimitCounts> {
    const t = now.getTime();
    const hourAgo = new Date(t - HOUR);
    const dayAgo = new Date(t - DAY);
    const personSince = new Date(t - limits.perPersonDays * DAY);
    const { rows } = await this.pool.query(
      `select count(*) filter (where c.platform = $1 and ${SENT_AT} > $3)::int as platform_hour,
              count(*) filter (where c.platform = $1 and ${SENT_AT} > $4)::int as platform_day,
              count(*) filter (where ${SENT_AT} > $4)::int as global_day,
              count(*) filter (where c.platform = $1 and a.kind = 'reply' and a.origin = 'auto' and c.author_id = $5 and ${SENT_AT} >= $6)::int as author_window
         ${FROM_ACTIONS}
        where a.status in ('sent','sending') and ${SENT_AT} <= $2 and ${SENT_AT} >= least($4::timestamptz, $6::timestamptz)`,
      [platform, now, hourAgo, dayAgo, authorId, personSince],
    );
    const r = rows[0] ?? {};
    return {
      platformHour: Number(r.platform_hour ?? 0),
      platformDay: Number(r.platform_day ?? 0),
      globalDay: Number(r.global_day ?? 0),
      authorWindow: authorId === null ? 0 : Number(r.author_window ?? 0),
    };
  }

  /** Newest first: actions that left 'sending' (or were decided without a send, e.g. "comment gone"). */
  async recentOutcomes(platform: EngagementPlatform, n: number): Promise<Array<{ ok: boolean; error?: string }>> {
    const { rows } = await this.pool.query(
      `select a.status, a.last_error ${FROM_ACTIONS}
        where c.platform = $1 and (a.status in ('sent','failed','unknown') or (a.status = 'planned' and a.attempts > 0))
        order by a.updated_at desc limit $2`,
      [platform, n],
    );
    return (rows as Array<{ status: ActionStatus; last_error: string | null }>).map((r) =>
      r.status === "sent" ? { ok: true } : { ok: false, ...(r.last_error != null ? { error: r.last_error } : {}) },
    );
  }

  /** True when inserted; skipped while an unacknowledged alert with the same kind + message prefix exists. */
  async recordAlert(alert: EngagementAlert): Promise<boolean> {
    const { rows } = await this.pool.query(
      `insert into alerts (kind, batch_item_id, platform, message, created_at)
       select $1, null, $2, $3, $4
        where not exists (select 1 from alerts where kind = $1 and acknowledged_at is null and left(message, ${ALERT_DEDUPE_PREFIX}) = left($3::text, ${ALERT_DEDUPE_PREFIX}))
       returning id`,
      [alert.kind, alert.platform, alert.message, alert.at],
    );
    return rows.length === 1;
  }

  // ---- ActionHistory ----
  async lastRepliesOn(platform: EngagementPlatform, n: number): Promise<string[]> {
    const { rows } = await this.pool.query(
      `select a.text ${FROM_ACTIONS}
        where c.platform = $1 and a.kind = 'reply' and a.status = 'sent' and a.text is not null
        order by ${SENT_AT} desc limit $2`,
      [platform, n],
    );
    return rows.map((r: { text: string }) => r.text);
  }

  async repliesToAuthorSince(platform: EngagementPlatform, authorId: string, since: Date): Promise<string[]> {
    const { rows } = await this.pool.query(
      `select a.text ${FROM_ACTIONS}
        where c.platform = $1 and c.author_id = $2 and a.kind = 'reply' and a.origin = 'auto' and a.status in ('sent','sending') and ${SENT_AT} >= $3
        order by ${SENT_AT} desc`,
      [platform, authorId, since],
    );
    return rows.map((r: { text: string | null }) => r.text ?? "");
  }

  async countSent(platform: EngagementPlatform | "all", since: Date): Promise<number> {
    const { rows } = await this.pool.query(
      `select count(*)::int as n ${FROM_ACTIONS}
        where a.status in ('sent','sending') and ${SENT_AT} >= $2 and ($1::text = 'all' or c.platform = $1)`,
      [platform, since],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async textUseCount(platform: EngagementPlatform, text: string, since: Date): Promise<number> {
    const { rows } = await this.pool.query(
      `select count(*)::int as n ${FROM_ACTIONS}
        where c.platform = $1 and a.kind = 'reply' and a.text = $2 and a.status in ('sent','sending') and ${SENT_AT} >= $3`,
      [platform, text, since],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async isBlockedAuthor(platform: EngagementPlatform, authorId: string): Promise<boolean> {
    const { rows } = await this.pool.query(`select 1 from engagement_blocklist where platform = $1 and author_id = $2`, [platform, authorId]);
    return rows.length > 0;
  }

  // ---- comments + triage ----
  /**
   * Inserts new comments (on conflict do nothing) and links each to its batch item by
   * platform_media_id = batch_items.platform_post_id. Our own replies in a thread are stored too
   * (is_own, parent = the comment) so a later read sees "human replied". Returns how many of
   * `comments` were new (own-reply rows aren't counted).
   */
  async upsertComments(comments: InboundComment[], now: Date): Promise<number> {
    let inserted = 0;
    const insert = (c: {
      platform: EngagementPlatform; id: string; media: string; parent: string | null; authorId: string | null; handle: string | null; text: string; isOwn: boolean; at: string;
    }) =>
      this.pool.query(
        `insert into comments (platform, platform_comment_id, platform_media_id, batch_item_id, parent_platform_id, author_id, author_handle, text, is_own, commented_at, fetched_at)
         values ($1, $2, $3, (select id from batch_items where platform = $1 and platform_post_id = $3 limit 1), $4, $5, $6, $7, $8, $9, $10)
         on conflict (platform, platform_comment_id) do nothing
         returning id`,
        [c.platform, c.id, c.media, c.parent, c.authorId, c.handle, c.text, c.isOwn, c.at, now],
      );
    for (const c of comments) {
      const res = await insert({
        platform: c.platform, id: c.platformCommentId, media: c.platformMediaId, parent: c.parentId ?? null,
        authorId: c.authorId, handle: c.authorHandle ?? null, text: c.text, isOwn: c.isOwn, at: c.createdAt,
      });
      if (res.rows.length === 1) inserted++;
      for (const r of c.ownRepliesInThread) {
        await insert({
          platform: c.platform, id: r.platformCommentId, media: c.platformMediaId, parent: c.platformCommentId,
          authorId: null, handle: null, text: r.text, isOwn: true, at: r.createdAt,
        });
      }
    }
    return inserted;
  }

  /** Comments without a triage row, not our own, newest first, with the post caption + pillar when linked. */
  async listUntriaged(limit: number): Promise<UntriagedComment[]> {
    const { rows } = await this.pool.query(
      `select c.id, c.platform, c.platform_comment_id, c.platform_media_id, c.parent_platform_id, c.author_id, c.author_handle,
              c.text, c.is_own, c.commented_at, bi.caption, m.pillar,
              coalesce((select json_agg(json_build_object('platformCommentId', o.platform_comment_id, 'text', o.text, 'createdAt', o.commented_at) order by o.commented_at)
                          from comments o where o.platform = c.platform and o.parent_platform_id = c.platform_comment_id and o.is_own), '[]'::json) as own_replies
         from comments c
         left join comment_triage t on t.comment_id = c.id
         left join batch_items bi on bi.id = c.batch_item_id
         left join media m on m.id = bi.media_id
        where t.comment_id is null and not c.is_own
        order by c.commented_at desc limit $1`,
      [limit],
    );
    return rows.map((r: any): UntriagedComment => {
      const own = (Array.isArray(r.own_replies) ? r.own_replies : []) as Array<{ platformCommentId: string; text: string; createdAt: string }>;
      const comment: InboundComment = {
        platform: r.platform,
        platformCommentId: r.platform_comment_id,
        platformMediaId: r.platform_media_id,
        ...(r.parent_platform_id ? { parentId: r.parent_platform_id } : {}),
        authorId: r.author_id,
        ...(r.author_handle ? { authorHandle: r.author_handle } : {}),
        text: r.text,
        createdAt: iso(r.commented_at)!,
        isOwn: r.is_own,
        ownRepliesInThread: own.map((o) => ({ platformCommentId: o.platformCommentId, text: o.text, createdAt: iso(o.createdAt)! })),
      };
      const ctx: TriageContext = { ...(r.caption ? { postCaption: r.caption } : {}), pillar: r.pillar ?? null };
      return { id: r.id, comment, ctx };
    });
  }

  async saveTriage(commentId: string, result: TriageResult, now: Date): Promise<void> {
    await this.pool.query(
      `insert into comment_triage (comment_id, bucket, confidence, draft_reply, reasons, model, refused, decided_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (comment_id) do nothing`,
      [commentId, result.bucket, result.confidence, result.reply, result.reasons, result.model, result.refused ?? false, now],
    );
  }

  /** One reply + one hide per comment, ever. True when a row was inserted. */
  async insertAction(commentId: string, kind: ActionKind, text: string | null, status: "planned" | "shadow", notBefore: Date | string, now: Date): Promise<boolean> {
    const { rows } = await this.pool.query(
      `insert into engagement_actions (comment_id, kind, text, status, not_before, origin, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'auto', $6, $6) on conflict (comment_id, kind) do nothing returning id`,
      [commentId, kind, text, status, new Date(notBefore), now],
    );
    return rows.length === 1;
  }

  async getCursor(platform: string): Promise<CursorRow | null> {
    const { rows } = await this.pool.query(`select cursor, polled_at from engagement_cursors where platform = $1`, [platform]);
    const r = rows[0];
    return r ? { cursor: r.cursor ?? null, polledAt: r.polled_at ? new Date(r.polled_at) : null } : null;
  }

  async setCursor(platform: string, cursor: unknown, now: Date): Promise<void> {
    await this.pool.query(
      `insert into engagement_cursors (platform, cursor, polled_at) values ($1, $2::jsonb, $3)
       on conflict (platform) do update set cursor = excluded.cursor, polled_at = excluded.polled_at`,
      [platform, JSON.stringify(cursor ?? null), now],
    );
  }

  // ---- DMs (read + draft only) ----
  async upsertDmThreads(threads: DmThreadInput[], igUserId: string | null, now: Date): Promise<UpsertedDmThread[]> {
    void now;
    const out: UpsertedDmThread[] = [];
    for (const t of threads) {
      if (igUserId && t.participantId === igUserId) continue; // a thread with ourselves is not a conversation
      const { rows } = await this.pool.query(
        `insert into dm_threads (platform, platform_thread_id, participant_id, participant_handle) values ('instagram', $1, $2, $3)
         on conflict (platform_thread_id) do update set participant_handle = coalesce(excluded.participant_handle, dm_threads.participant_handle)
         returning id`,
        [t.platformThreadId, t.participantId, t.handle ?? null],
      );
      const threadId = rows[0]?.id as string | undefined;
      if (!threadId) continue;
      for (const m of t.messages) {
        await this.pool.query(
          `insert into dm_messages (thread_id, platform_message_id, direction, text, sent_at) values ($1, $2, $3, $4, $5)
           on conflict (platform_message_id) do nothing`,
          [threadId, m.id, m.dir, m.text, m.at],
        );
      }
      await this.pool.query(
        `update dm_threads set
           last_inbound_at = (select max(sent_at) from dm_messages where thread_id = $1 and direction = 'in'),
           last_outbound_at = (select max(sent_at) from dm_messages where thread_id = $1 and direction = 'out')
         where id = $1`,
        [threadId],
      );
      out.push({ threadId, thread: t });
    }
    return out;
  }

  async latestDraft(threadId: string): Promise<{ id: string; forPlatformMessageId: string | null } | null> {
    const { rows } = await this.pool.query(
      `select d.id, m.platform_message_id from dm_drafts d left join dm_messages m on m.id = d.for_message_id
        where d.thread_id = $1 order by d.created_at desc limit 1`,
      [threadId],
    );
    const r = rows[0];
    return r ? { id: r.id, forPlatformMessageId: r.platform_message_id ?? null } : null;
  }

  async insertDmDraft(threadId: string, forPlatformMessageId: string | null, text: string, bucket: string | null): Promise<void> {
    await this.pool.query(
      `insert into dm_drafts (thread_id, for_message_id, text, bucket)
       values ($1, (select id from dm_messages where platform_message_id = $2), $3, $4)`,
      [threadId, forPlatformMessageId, text, bucket],
    );
  }
}
