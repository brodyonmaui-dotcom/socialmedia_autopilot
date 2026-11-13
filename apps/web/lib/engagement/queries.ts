import type { Pool } from "pg";
import { dmWindow } from "@autopilot/engagement/src/dm.js";
import type { ActionStatus, Bucket, EngagementPlatform } from "@autopilot/engagement";

/** Inbox reads/writes. Every value is a parameter; nothing here removes rows (handled = a timestamp). */

export type InboxTab = "flagged" | "shadow" | "sent" | "dms";
export const INBOX_TABS: readonly InboxTab[] = ["flagged", "shadow", "sent", "dms"];

export interface InboxRow {
  commentId: string;
  platform: EngagementPlatform;
  platformCommentId: string;
  authorHandle: string | null;
  authorId: string | null;
  text: string;
  commentedAt: string;
  isOwn: boolean;
  bucket: Bucket | null;
  reasons: string[];
  /** triage.draft_reply, or the action's text on the shadow/sent tabs. */
  draft: string | null;
  handledAt: string | null;
  actionId?: string;
  actionKind?: "reply" | "hide";
  actionStatus?: ActionStatus;
  sentAt?: string | null;
  lastError?: string | null;
  postLabel?: string;
  postUrl?: string;
}

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

const BASE_COLUMNS = `
  c.id as comment_id, c.platform, c.platform_comment_id, c.author_handle, c.author_id, c.text, c.commented_at, c.is_own,
  t.bucket, t.reasons, t.draft_reply, t.handled_at,
  bi.caption as post_caption, bi.platform_post_url as post_url`;
const BASE_JOINS = `
  left join comment_triage t on t.comment_id = c.id
  left join batch_items bi on bi.id = c.batch_item_id`;

function postLabel(caption: unknown): string | undefined {
  if (typeof caption !== "string" || !caption.trim()) return undefined;
  const line = caption.trim().split("\n")[0]!;
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

function toRow(r: Record<string, any>): InboxRow {
  const row: InboxRow = {
    commentId: r.comment_id,
    platform: r.platform,
    platformCommentId: r.platform_comment_id,
    authorHandle: r.author_handle ?? null,
    authorId: r.author_id ?? null,
    text: r.text,
    commentedAt: iso(r.commented_at)!,
    isOwn: r.is_own === true,
    bucket: r.bucket ?? null,
    reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : [],
    draft: (r.action_text as string | null | undefined) ?? (r.draft_reply as string | null) ?? null,
    handledAt: iso(r.handled_at),
  };
  if (r.action_id) {
    row.actionId = r.action_id;
    row.actionKind = r.action_kind;
    row.actionStatus = r.action_status;
    row.sentAt = iso(r.sent_at);
    row.lastError = r.last_error ?? null;
  }
  const label = postLabel(r.post_caption);
  if (label) row.postLabel = label;
  if (r.post_url) row.postUrl = r.post_url;
  return row;
}

export async function listInbox(pool: Pool, tab: Exclude<InboxTab, "dms">, limit = 100): Promise<InboxRow[]> {
  if (tab === "flagged") {
    const { rows } = await pool.query(
      `select ${BASE_COLUMNS}, null::text as action_text
         from comments c ${BASE_JOINS}
        where t.bucket in ('flag', 'hide_flag') and t.handled_at is null
        order by c.commented_at desc limit $1`,
      [limit],
    );
    return rows.map(toRow);
  }
  const statuses = tab === "shadow" ? ["shadow"] : ["sent", "failed", "unknown", "sending"];
  const { rows } = await pool.query(
    `select ${BASE_COLUMNS}, a.id as action_id, a.kind as action_kind, a.status as action_status, a.text as action_text,
            a.sent_at, a.last_error
       from engagement_actions a
       join comments c on c.id = a.comment_id ${BASE_JOINS}
      where a.status = any($1::text[])
      order by coalesce(a.sent_at, a.updated_at) desc limit $2`,
    [statuses, limit],
  );
  return rows.map(toRow);
}

export interface DmThreadView {
  id: string;
  platform: string;
  handle: string | null;
  participantId: string;
  lastInboundAt: string | null;
  windowEndsAt: string | null;
  open: boolean;
  /** Oldest first, at most 20. */
  messages: Array<{ id: string; dir: "in" | "out"; text: string; at: string }>;
  draft: { id: string; text: string; bucket: string | null } | null;
}

export async function listDmThreads(pool: Pool, now: Date = new Date(), limit = 50): Promise<DmThreadView[]> {
  const { rows } = await pool.query(
    `select t.id, t.platform, t.participant_handle, t.participant_id, t.last_inbound_at,
            coalesce((select json_agg(m order by m.sent_at) from (
               select id, direction, text, sent_at from dm_messages where thread_id = t.id order by sent_at desc limit 20
             ) m), '[]'::json) as messages,
            (select json_build_object('id', d.id, 'text', d.text, 'bucket', d.bucket) from dm_drafts d
              where d.thread_id = t.id and d.status = 'draft' order by d.created_at desc limit 1) as draft
       from dm_threads t
      where t.handled_at is null
      order by t.last_inbound_at desc nulls last limit $1`,
    [limit],
  );
  return rows.map((r) => {
    const last = iso(r.last_inbound_at);
    const w = last ? dmWindow(last, now) : null;
    return {
      id: r.id,
      platform: r.platform,
      handle: r.participant_handle ?? null,
      participantId: r.participant_id,
      lastInboundAt: last,
      windowEndsAt: w?.endsAt ?? null,
      open: w?.open ?? false,
      messages: (r.messages as Array<{ id: string; direction: "in" | "out"; text: string | null; sent_at: string }>).map((m) => ({
        id: m.id,
        dir: m.direction,
        text: m.text ?? "",
        at: iso(m.sent_at)!,
      })),
      draft: r.draft ? { id: r.draft.id, text: r.draft.text, bucket: r.draft.bucket ?? null } : null,
    };
  });
}

export async function counts(pool: Pool, now: Date = new Date()): Promise<{ flagged: number; shadow: number; dmsOpen: number }> {
  const { rows } = await pool.query(
    `select
       (select count(*)::int from comment_triage where bucket in ('flag', 'hide_flag') and handled_at is null) as flagged,
       (select count(*)::int from engagement_actions where status = 'shadow') as shadow,
       (select count(*)::int from dm_threads where handled_at is null and last_inbound_at > $1::timestamptz - interval '24 hours') as dms_open`,
    [now],
  );
  const r = rows[0] ?? {};
  return { flagged: r.flagged ?? 0, shadow: r.shadow ?? 0, dmsOpen: r.dms_open ?? 0 };
}

export async function markHandled(pool: Pool, commentId: string, now: Date): Promise<boolean> {
  const res = await pool.query(`update comment_triage set handled_at = $2 where comment_id = $1 and handled_at is null`, [commentId, now]);
  return res.rowCount === 1;
}

export async function blockAuthor(pool: Pool, platform: EngagementPlatform, authorId: string): Promise<void> {
  await pool.query(`insert into engagement_blocklist (platform, author_id) values ($1, $2) on conflict do nothing`, [platform, authorId]);
}

export type ManualActionResult = { ok: true; id: string } | { ok: false; reason: string };

/** A manual reply/hide, planned now. The unique (comment_id, kind) is the double-reply guard. */
export async function createManualAction(pool: Pool, commentId: string, kind: "reply" | "hide", text: string | null, now: Date): Promise<ManualActionResult> {
  const { rows } = await pool.query(
    `insert into engagement_actions (comment_id, kind, text, status, not_before, origin, created_at, updated_at)
     values ($1, $2, $3, 'planned', $4, 'manual', $4, $4)
     on conflict (comment_id, kind) do nothing returning id`,
    [commentId, kind, text, now],
  );
  const id = rows[0]?.id as string | undefined;
  return id ? { ok: true, id } : { ok: false, reason: "an action already exists for this comment" };
}

export async function markDraftCopied(pool: Pool, draftId: string): Promise<void> {
  await pool.query(`update dm_drafts set status = 'copied' where id = $1 and status = 'draft'`, [draftId]);
}

export async function writeEngagementAlert(pool: Pool, kind: "engagement-kill" | "engagement-mode", platform: string, message: string): Promise<void> {
  await pool.query(`insert into alerts (kind, platform, message) values ($1, $2, $3)`, [kind, platform, message]);
}

/** One comment with its triage, for the manual actions (server-side, never trusting the form). */
export async function getComment(pool: Pool, commentId: string): Promise<InboxRow | null> {
  const { rows } = await pool.query(`select ${BASE_COLUMNS}, null::text as action_text from comments c ${BASE_JOINS} where c.id = $1`, [commentId]);
  return rows[0] ? toRow(rows[0]) : null;
}

/** "just now" / "12 min ago" / "3 h ago" / "2 d ago". */
export function relativeTime(at: string, now: Date): string {
  const ms = now.getTime() - Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** Shadow → planned (manual) in one conditional update; false when it was already promoted or went out. */
export async function promoteShadow(pool: Pool, actionId: string, now: Date): Promise<boolean> {
  const { rows } = await pool.query(
    `update engagement_actions set status = 'planned', origin = 'manual', not_before = $2, updated_at = $2
      where id = $1 and status = 'shadow' returning id`,
    [actionId, now],
  );
  return rows.length === 1;
}
