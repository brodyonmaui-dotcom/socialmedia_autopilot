import type { Pool, PoolClient } from "pg";
import { promoAuthorKey } from "@autopilot/engagement/src/rules.js";
import type { EngagementPlatform } from "@autopilot/engagement";

/**
 * Run 4 promo-account list (engagement_promo_accounts) and the two inbox moves around it:
 *  - "Always ignore this account": list the author (source 'manual') and re-bucket their open items as
 *    spam_promo (comments) / ignored (DM threads). HIDE verdicts stay (threats must reach him); pending
 *    shadow/planned replies to them are cancelled (a status change, never a delete).
 *  - "Not spam": one comment goes back through triage without the promo rule (shown as a flag until the
 *    worker re-triages it); a DM thread is un-ignored and marked so the poll never re-ignores it. When the
 *    author was listed by a rule, that list row is closed (removed_at).
 * Nothing here deletes a row.
 */

export interface PromoAccountRow {
  id: string;
  platform: EngagementPlatform;
  authorKey: string;
  displayHandle: string | null;
  source: "manual" | "rule";
  createdAt: string;
}

/** dm_threads.ignored_reason after "Not spam": the DM poll leaves such a thread alone. */
export const DM_NOT_SPAM = "not-spam";

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
type Q = Pick<Pool, "query"> | PoolClient;

export async function loadPromoAccounts(pool: Q): Promise<PromoAccountRow[]> {
  const { rows } = await pool.query(
    `select id, platform, author_key, display_handle, source, created_at from engagement_promo_accounts where removed_at is null order by created_at desc, id`,
  );
  return rows.map((r: Record<string, any>) => ({ id: r.id, platform: r.platform, authorKey: r.author_key, displayHandle: r.display_handle ?? null, source: r.source, createdAt: iso(r.created_at) }));
}

export type AddPromoTarget = { commentId: string } | { threadId: string };
export interface AddPromoResult { added: boolean; authorKey: string; platform: EngagementPlatform; commentsMoved: number; threadsIgnored: number; repliesCancelled: number }

async function inTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** "Always ignore this account" from a comment or a DM thread. Null when the item or its author is unknown. */
export async function addPromoAccount(pool: Pool, target: AddPromoTarget, now: Date): Promise<AddPromoResult | null> {
  const src =
    "commentId" in target
      ? (await pool.query(`select platform, author_id, author_handle from comments where id = $1 and not is_own`, [target.commentId])).rows[0]
      : (await pool.query(`select platform, participant_id as author_id, participant_handle as author_handle from dm_threads where id = $1`, [target.threadId])).rows[0];
  if (!src) return null;
  const key = promoAuthorKey(src.author_id, src.author_handle);
  if (!key) return null;
  const platform = src.platform as EngagementPlatform;
  return inTx(pool, async (c) => {
    const ins = await c.query(
      `insert into engagement_promo_accounts (platform, author_key, display_handle, source, created_at) values ($1, $2, $3, 'manual', $4)
       on conflict (platform, author_key) where removed_at is null do nothing returning id`,
      [platform, key, src.author_handle ?? null, now],
    );
    // An open 'rule' row becomes the creator's own decision.
    if (!ins.rows.length) await c.query(`update engagement_promo_accounts set source = 'manual' where platform = $1 and author_key = $2 and removed_at is null`, [platform, key]);
    const author = `c.platform = $1 and ((c.author_id is not null and c.author_id = $2) or (c.author_id is null and lower(c.author_handle) = $2))`;
    const cancelled = await c.query(
      `update engagement_actions a set status = 'cancelled', last_error = 'author ignored as promo', updated_at = $3
         from comments c where c.id = a.comment_id and ${author} and a.status in ('shadow','planned')
        returning a.id`,
      [platform, key, now],
    );
    const moved = await c.query(
      `update comment_triage t set bucket = 'spam_promo', draft_reply = null, reasons = array_append(coalesce(t.reasons, '{}'), 'promo:list'), retriage_requested_at = null
         from comments c where c.id = t.comment_id and ${author} and t.handled_at is null and t.bucket not in ('spam_promo','hide_flag')
          and not exists (select 1 from engagement_actions a where a.comment_id = c.id and a.status in ('sending','sent','unknown'))
        returning t.comment_id`,
      [platform, key],
    );
    const threads = await c.query(
      `update dm_threads set ignored_reason = 'promo:list', ignored_at = $3
        where platform = $1 and (participant_id = $2 or lower(participant_handle) = $2) and ignored_at is null returning id`,
      [platform, key, now],
    );
    return { added: ins.rows.length === 1, authorKey: key, platform, commentsMoved: moved.rows.length, threadsIgnored: threads.rows.length, repliesCancelled: cancelled.rows.length };
  });
}

/** Close one list row (removed_at). The author's past items keep their bucket; new ones triage normally. */
export async function removePromoAccount(pool: Q, id: string, now: Date): Promise<boolean> {
  const res = await pool.query(`update engagement_promo_accounts set removed_at = $2 where id = $1 and removed_at is null`, [id, now]);
  return (res.rowCount ?? 0) === 1;
}

export interface NotSpamResult { moved: boolean; listRemoved: boolean }

/** "Not spam" on one comment (re-triage without the promo rule) or one DM thread (un-ignore). */
export async function markNotSpam(pool: Pool, target: AddPromoTarget, now: Date): Promise<NotSpamResult> {
  return inTx(pool, async (c) => {
    let src: Record<string, any> | undefined;
    let moved = false;
    if ("commentId" in target) {
      const res = await c.query(
        `update comment_triage set bucket = 'flag', draft_reply = null, not_spam_at = $2, retriage_requested_at = $2,
                reasons = array_append(coalesce(reasons, '{}'), 'not spam (creator): re-triage pending')
          where comment_id = $1 and bucket = 'spam_promo' returning comment_id`,
        [target.commentId, now],
      );
      moved = res.rows.length === 1;
      src = (await c.query(`select platform, author_id, author_handle from comments where id = $1`, [target.commentId])).rows[0];
    } else {
      const res = await c.query(
        `update dm_threads set ignored_at = null, ignored_reason = '${DM_NOT_SPAM}' where id = $1 and ignored_at is not null returning id`,
        [target.threadId],
      );
      moved = res.rows.length === 1;
      src = (await c.query(`select platform, participant_id as author_id, participant_handle as author_handle from dm_threads where id = $1`, [target.threadId])).rows[0];
    }
    let listRemoved = false;
    const key = src ? promoAuthorKey(src.author_id, src.author_handle) : null;
    if (moved && key) {
      const res = await c.query(
        `update engagement_promo_accounts set removed_at = $3 where platform = $1 and author_key = $2 and source = 'rule' and removed_at is null`,
        [src!.platform, key, now],
      );
      listRemoved = (res.rowCount ?? 0) > 0;
    }
    return { moved, listRemoved };
  });
}
