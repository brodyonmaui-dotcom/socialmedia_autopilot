import type { Pool } from "pg";
import { dmWindow } from "@autopilot/engagement/src/dm.js";
import type { ActionStatus, Bucket, EngagementPlatform } from "@autopilot/engagement";
import { relativeTime } from "../engagement/queries.js";

/**
 * Run 4 inbox lists for the designer's pages. Comments and DMs, four filters each:
 *  needs-you: flagged (flag / hide_flag) and not handled · drafted: a shadow reply waits for one tap ·
 *  sent: replies queued or out (planned, sending, sent, failed, unknown) / DM drafts copied ·
 *  ignored: promo spam (comments bucket spam_promo, DM threads with ignored_at).
 * Promo never appears outside "ignored". Keyset pagination on (at, id), newest first. Read-only.
 */

export type InboxKind = "comments" | "dms";
export type InboxFilter = "needs-you" | "drafted" | "sent" | "ignored";
export const INBOX_FILTERS: readonly InboxFilter[] = ["needs-you", "drafted", "sent", "ignored"];

/** What the row's buttons may do (the server actions re-check everything). */
export type InboxRowAction = "approve" | "edit" | "reply" | "done" | "ignore-account" | "not-spam" | "block" | "hide" | "copy" | "open";

export interface InboxListRow {
  kind: "comment" | "dm";
  /** comment id or dm thread id */
  id: string;
  platform: EngagementPlatform;
  /** "@handle" or "unknown author" */
  authorName: string;
  authorHandle: string | null;
  at: string;
  /** "12 min ago" */
  age: string;
  text: string;
  /** triage bucket (comments) or DM draft bucket / "spam_promo" for ignored threads */
  bucket: Bucket | string | null;
  /** triage reasons joined, or the DM ignored reason */
  reason: string | null;
  draftedReply: string | null;
  replyStatus: ActionStatus | null;
  /** DM draft id (copy) */
  draftId?: string;
  /** /inbox/item/<id> for comments */
  href: string | null;
  actions: InboxRowAction[];
}

export interface LoadInboxOptions {
  kind: InboxKind;
  filter: InboxFilter;
  limit?: number;
  cursor?: string | null;
  now?: Date;
  /** Only this platform's rows (F20: the notification links `?platform=instagram`). */
  platform?: EngagementPlatform | null;
}

export const INBOX_PLATFORMS: readonly EngagementPlatform[] = ["instagram", "youtube", "tiktok"];
/** A ?platform= value from the URL → a known platform, else null (never reaches SQL unchecked). */
export function parsePlatform(raw: unknown): EngagementPlatform | null {
  return (INBOX_PLATFORMS as readonly unknown[]).includes(raw) ? (raw as EngagementPlatform) : null;
}

export interface InboxPage {
  rows: InboxListRow[];
  nextCursor: string | null;
  counts: Record<InboxFilter, number>;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const name = (h: unknown) => (typeof h === "string" && h ? `@${h.replace(/^@+/, "")}` : "unknown author");

/** "<iso>|<uuid>" (opaque to the page; pass back unchanged). Malformed → first page. */
export function parseCursor(cursor: string | null | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  const [at, id] = cursor.split("|");
  if (!at || !id || !UUID.test(id) || !Number.isFinite(Date.parse(at))) return null;
  return { at: new Date(at).toISOString(), id };
}
const makeCursor = (r: { at: string; id: string }) => `${r.at}|${r.id}`;

export const COMMENT_WHERE: Record<InboxFilter, string> = {
  "needs-you": `t.bucket in ('flag','hide_flag') and t.handled_at is null and a.id is null`,
  drafted: `a.status = 'shadow' and t.handled_at is null and t.bucket <> 'spam_promo'`,
  sent: `a.status in ('planned','sending','sent','failed','unknown')`,
  ignored: `t.bucket = 'spam_promo'`,
};
export const DM_WHERE: Record<InboxFilter, string> = {
  "needs-you": `t.ignored_at is null and t.handled_at is null and d.id is null and t.last_inbound_at is not null`,
  drafted: `t.ignored_at is null and t.handled_at is null and d.status = 'draft'`,
  sent: `t.ignored_at is null and d.status = 'copied'`,
  ignored: `t.ignored_at is not null`,
};

export const COMMENT_FROM = `
  from comments c
  join comment_triage t on t.comment_id = c.id
  left join engagement_actions a on a.comment_id = c.id and a.kind = 'reply'
 where not c.is_own`;
export const DM_FROM = `
  from dm_threads t
  left join lateral (select id, text, bucket, status from dm_drafts where thread_id = t.id order by created_at desc limit 1) d on true
 where true`;

function commentActions(filter: InboxFilter, r: Record<string, any>): InboxRowAction[] {
  const out: InboxRowAction[] = ["open"];
  if (filter === "ignored") return [...out, "not-spam"];
  if (filter === "drafted") out.push("approve", "edit");
  if (filter === "needs-you") {
    if (r.bucket === "flag") out.push(r.draft_reply ? "approve" : "reply");
    if (r.bucket === "hide_flag" && r.platform === "instagram") out.push("hide");
  }
  if (filter !== "sent") out.push("done", "ignore-account");
  if (r.author_id) out.push("block");
  return out;
}

function dmActions(filter: InboxFilter, hasDraft: boolean): InboxRowAction[] {
  if (filter === "ignored") return ["not-spam"];
  return [...(hasDraft ? (["copy"] as const) : []), "done", "ignore-account"];
}

export async function inboxCounts(pool: Pick<Pool, "query">, kind: InboxKind, platform: EngagementPlatform | null = null): Promise<Record<InboxFilter, number>> {
  const where = kind === "comments" ? COMMENT_WHERE : DM_WHERE;
  const from = kind === "comments" ? COMMENT_FROM : DM_FROM;
  const cols = INBOX_FILTERS.map((f, i) => `count(*) filter (where ${where[f]})::int as f${i}`).join(", ");
  const plat = platform ? ` and ${kind === "comments" ? "c" : "t"}.platform = $1` : "";
  const { rows } = await pool.query(`select ${cols} ${from}${plat}`, platform ? [platform] : []);
  const r = rows[0] ?? {};
  return Object.fromEntries(INBOX_FILTERS.map((f, i) => [f, Number(r[`f${i}`] ?? 0)])) as Record<InboxFilter, number>;
}

export async function loadInbox(pool: Pick<Pool, "query">, opts: LoadInboxOptions): Promise<InboxPage> {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 30)), 100);
  const now = opts.now ?? new Date();
  const cur = parseCursor(opts.cursor);
  const filter = (INBOX_FILTERS as readonly string[]).includes(opts.filter) ? opts.filter : "needs-you";
  const platform = parsePlatform(opts.platform);
  const counts = await inboxCounts(pool, opts.kind, platform);

  if (opts.kind === "comments") {
    const at = filter === "sent" ? "coalesce(a.sent_at, a.updated_at)" : "c.commented_at";
    const { rows } = await pool.query(
      `select c.id, c.platform, c.author_handle, c.author_id, c.text, ${at} as at,
              t.bucket, t.reasons, t.draft_reply, a.status as action_status, a.text as action_text
         ${COMMENT_FROM} and ${COMMENT_WHERE[filter]}
          and ($1::timestamptz is null or (${at}, c.id) < ($1::timestamptz, $2::uuid))
          and ($4::text is null or c.platform = $4)
        order by ${at} desc, c.id desc limit $3`,
      [cur?.at ?? null, cur?.id ?? null, limit + 1, platform],
    );
    const page = rows.slice(0, limit).map((r: Record<string, any>): InboxListRow => {
      const atIso = iso(r.at);
      return {
        kind: "comment",
        id: r.id,
        platform: r.platform,
        authorName: name(r.author_handle),
        authorHandle: r.author_handle ?? null,
        at: atIso,
        age: relativeTime(atIso, now),
        text: r.text,
        bucket: r.bucket ?? null,
        reason: Array.isArray(r.reasons) && r.reasons.length ? r.reasons.join("; ") : null,
        draftedReply: r.action_text ?? r.draft_reply ?? null,
        replyStatus: r.action_status ?? null,
        href: `/inbox/item/${r.id}`,
        actions: commentActions(filter, r),
      };
    });
    return { rows: page, nextCursor: rows.length > limit && page.length ? makeCursor(page.at(-1)!) : null, counts };
  }

  const at = "coalesce(t.last_inbound_at, t.ignored_at, now())";
  const { rows } = await pool.query(
    `select t.id, t.platform, t.participant_handle, t.ignored_reason, t.last_inbound_at, ${at} as at,
            d.id as draft_id, d.text as draft_text, d.bucket as draft_bucket, d.status as draft_status,
            (select m.text from dm_messages m where m.thread_id = t.id and m.direction = 'in' order by m.sent_at desc limit 1) as last_text
       ${DM_FROM} and ${DM_WHERE[filter]}
        and ($1::timestamptz is null or (${at}, t.id) < ($1::timestamptz, $2::uuid))
        and ($4::text is null or t.platform = $4)
      order by ${at} desc, t.id desc limit $3`,
    [cur?.at ?? null, cur?.id ?? null, limit + 1, platform],
  );
  const page = rows.slice(0, limit).map((r: Record<string, any>): InboxListRow => {
    const atIso = iso(r.at);
    const open = r.last_inbound_at ? dmWindow(iso(r.last_inbound_at), now).open : false;
    const hasDraft = filter !== "ignored" && r.draft_status === "draft";
    return {
      kind: "dm",
      id: r.id,
      platform: r.platform,
      authorName: name(r.participant_handle),
      authorHandle: r.participant_handle ?? null,
      at: atIso,
      age: relativeTime(atIso, now),
      text: r.last_text ?? "",
      bucket: filter === "ignored" ? "spam_promo" : (r.draft_bucket ?? null),
      reason: filter === "ignored" ? (r.ignored_reason ?? "promo") : open ? null : "window closed: copy + open Instagram",
      draftedReply: filter === "ignored" ? null : (r.draft_text ?? null),
      replyStatus: null,
      ...(hasDraft && r.draft_id ? { draftId: r.draft_id } : {}),
      href: null,
      actions: dmActions(filter, hasDraft),
    };
  });
  return { rows: page, nextCursor: rows.length > limit && page.length ? makeCursor(page.at(-1)!) : null, counts };
}
