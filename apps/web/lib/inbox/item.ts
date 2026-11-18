import type { Pool } from "pg";
import { lintText } from "@autopilot/research";
import { normalizeEngagement } from "@autopilot/engagement/src/settings.js";
import type { ActionStatus, Bucket, EngagementPlatform } from "@autopilot/engagement";
import { getSetting } from "@autopilot/db";
import { createManualAction, relativeTime } from "../engagement/queries.js";

/**
 * Run 4: one inbox item (/inbox/item/[id], the push deep link) and "Approve & send".
 * approveAndSend never talks to a platform. It turns the stored shadow/drafted reply into a manual
 * `planned` action (the existing manual-send path: same row, same unique (comment_id, kind) guard),
 * and the worker's send tick applies every gate (dry-run + live flag, kill switch, limits, blocklist,
 * capability, thread re-read, unknown-state handling). Nothing here deletes anything.
 */

export interface InboxItem {
  commentId: string;
  platform: EngagementPlatform;
  authorHandle: string | null;
  authorId: string | null;
  /** "@handle" or "unknown author". */
  authorName: string;
  text: string;
  commentedAt: string;
  age: string;
  isOwn: boolean;
  postTitle: string | null;
  postUrl: string | null;
  /** The post's media row (batch_items.media_id) for the poster; null when the comment has no batch item. */
  mediaId: string | null;
  triage: { bucket: Bucket; reasons: string[]; confidence: number | null; model: string | null; decidedAt: string; handledAt: string | null; notSpamAt: string | null } | null;
  /** The reply that would go out: the action's text, else the triage draft. */
  draftedReply: string | null;
  reply: { actionId: string; status: ActionStatus; origin: "auto" | "manual"; text: string | null; sentAt: string | null; lastError: string | null } | null;
  state: InboxItemState;
}

/** ignored = promo spam; drafted = a shadow reply waits for approval; queued = planned/sending; done = handled. */
export type InboxItemState = "untriaged" | "ignored" | "needs-you" | "drafted" | "queued" | "sent" | "failed" | "unknown" | "cancelled" | "done";

export type ApproveResult =
  | { status: "sent"; already: true; actionId: string; message: string }
  | { status: "queued"; already: boolean; dryRun: boolean; actionId: string; message: string }
  | { status: "refused"; reason: string };

export interface ApproveDeps {
  pool: Pool;
  /** True unless the server env says DRY_RUN=false (the worker additionally needs its live flag). */
  dryRun: boolean;
  /** ENGAGEMENT_KILL in the env. */
  killEnv: boolean;
  blocklist: string[];
}

export interface ApproveInput {
  /** Edited reply text; omitted = the drafted reply. */
  text?: string;
  sessionId: string;
  now: Date;
}

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_MANUAL_REPLY_CHARS = 300;

function stateOf(t: InboxItem["triage"], reply: InboxItem["reply"]): InboxItemState {
  if (!t) return "untriaged";
  if (reply) {
    switch (reply.status) {
      case "shadow":
        return t.handledAt ? "done" : "drafted";
      case "planned":
      case "sending":
        return "queued";
      case "sent":
        return "sent";
      case "failed":
        return "failed";
      case "unknown":
        return "unknown";
      case "cancelled":
        return "cancelled";
    }
  }
  if (t.bucket === "spam_promo") return "ignored";
  if (t.handledAt) return "done";
  return t.bucket === "flag" || t.bucket === "hide_flag" ? "needs-you" : "done";
}

function postTitle(caption: unknown, title: unknown): string | null {
  const raw = typeof title === "string" && title.trim() ? title : typeof caption === "string" ? caption : "";
  const line = raw.trim().split("\n")[0] ?? "";
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

export async function loadInboxItem(pool: Pick<Pool, "query">, id: string, now: Date = new Date()): Promise<InboxItem | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await pool.query(
    `select c.id, c.platform, c.author_handle, c.author_id, c.text, c.commented_at, c.is_own,
            bi.caption, bi.title, bi.platform_post_url, bi.media_id,
            t.bucket, t.reasons, t.confidence, t.model, t.decided_at, t.handled_at, t.not_spam_at, t.draft_reply,
            a.id as action_id, a.status as action_status, a.origin as action_origin, a.text as action_text, a.sent_at, a.last_error
       from comments c
       left join comment_triage t on t.comment_id = c.id
       left join batch_items bi on bi.id = c.batch_item_id
       left join engagement_actions a on a.comment_id = c.id and a.kind = 'reply'
      where c.id = $1`,
    [id],
  );
  const r = rows[0] as Record<string, any> | undefined;
  if (!r) return null;
  const triage: InboxItem["triage"] = r.bucket
    ? {
        bucket: r.bucket,
        reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : [],
        confidence: r.confidence == null ? null : Number(r.confidence),
        model: r.model ?? null,
        decidedAt: iso(r.decided_at)!,
        handledAt: iso(r.handled_at),
        notSpamAt: iso(r.not_spam_at),
      }
    : null;
  const reply: InboxItem["reply"] = r.action_id
    ? { actionId: r.action_id, status: r.action_status, origin: r.action_origin, text: r.action_text ?? null, sentAt: iso(r.sent_at), lastError: r.last_error ?? null }
    : null;
  const commentedAt = iso(r.commented_at)!;
  return {
    commentId: r.id,
    platform: r.platform,
    authorHandle: r.author_handle ?? null,
    authorId: r.author_id ?? null,
    authorName: r.author_handle ? `@${String(r.author_handle).replace(/^@+/, "")}` : "unknown author",
    text: r.text,
    commentedAt,
    age: relativeTime(commentedAt, now),
    isOwn: r.is_own === true,
    postTitle: postTitle(r.caption, r.title),
    postUrl: r.platform_post_url ?? null,
    mediaId: r.media_id ?? null,
    triage,
    draftedReply: reply?.text ?? r.draft_reply ?? null,
    reply,
    state: stateOf(triage, reply),
  };
}

/** Same checks as the post-rules on a drafted reply (privacy lint is an error, no links), plus a length cap. */
export function manualReplyProblem(text: string, blocklist: string[]): string | null {
  const t = text.trim();
  if (!t) return "the reply is empty";
  if (t.length > MAX_MANUAL_REPLY_CHARS) return `the reply is longer than ${MAX_MANUAL_REPLY_CHARS} characters`;
  if (/http|www\.|\.com|t\.me|wa\.me|linktr/i.test(t)) return "the reply has a link";
  const lint = lintText({ text: t, kind: "reply", blocklist });
  const privacy = lint.issues.filter((i) => i.severity === "error" && i.rule.startsWith("privacy."));
  if (privacy.length) return "the reply names a place or a private term";
  return null;
}

async function ackReplyReady(pool: Pick<Pool, "query">, commentId: string, sessionId: string, now: Date): Promise<void> {
  await pool.query(
    `update alerts set acknowledged_at = $3, acknowledged_session = $2
      where kind = 'reply-ready' and comment_id = $1 and acknowledged_at is null`,
    [commentId, UUID.test(sessionId) ? sessionId : null, now],
  );
}

const queuedMessage = (dryRun: boolean, already: boolean) =>
  already
    ? "already queued"
    : dryRun
      ? "dry run: recorded what would be sent; the worker will not send it while DRY_RUN is on"
      : "queued: the worker sends it on its next tick (kill switch, limits and the thread check still apply)";

/**
 * One-tap "Approve & send". Idempotent: a second tap reports "already queued/sent". Refuses promo spam,
 * hide+flag comments, own comments, a killed engine, a blocked author, TikTok (no comment replies) and
 * any reply text that fails the privacy lint. Acknowledges the item's reply-ready alert when it queues.
 */
export async function approveAndSend(deps: ApproveDeps, id: string, input: ApproveInput): Promise<ApproveResult> {
  const { pool, now } = { pool: deps.pool, now: input.now };
  const item = await loadInboxItem(pool, id, now);
  if (!item) return { status: "refused", reason: "unknown comment" };
  if (item.isOwn) return { status: "refused", reason: "that's your own comment" };

  // Double tap / already decided: report the existing row, never create a second one.
  const existing = item.reply;
  if (existing && existing.status !== "shadow") {
    if (existing.status === "sent") return { status: "sent", already: true, actionId: existing.actionId, message: "already sent" };
    if (existing.status === "planned" || existing.status === "sending")
      return { status: "queued", already: true, dryRun: deps.dryRun, actionId: existing.actionId, message: queuedMessage(deps.dryRun, true) };
    if (existing.status === "unknown") return { status: "refused", reason: "the last send has an unknown outcome: check the thread on the platform first" };
    if (existing.status === "failed") return { status: "refused", reason: "the last send failed: see Alerts" };
    return { status: "refused", reason: "this reply was cancelled (you had already replied in the thread)" };
  }

  if (!item.triage) return { status: "refused", reason: "not triaged yet" };
  if (item.triage.bucket === "spam_promo") return { status: "refused", reason: "ignored as promo spam: tap Not spam first" };
  if (item.triage.bucket === "hide_flag") return { status: "refused", reason: "flagged as abusive: no reply from here" };
  if (item.platform === "tiktok") return { status: "refused", reason: "TikTok comment replies are not supported" };

  const settings = normalizeEngagement(await getSetting<unknown>(pool as Pool, "engagement"));
  if (settings.killed || deps.killEnv) return { status: "refused", reason: "auto-replies are killed: resume first" };
  if (item.authorId) {
    const { rows } = await pool.query(`select 1 from engagement_blocklist where platform = $1 and author_id = $2`, [item.platform, item.authorId]);
    if (rows.length) return { status: "refused", reason: "you blocked replies to this person" };
  }

  const edited = typeof input.text === "string" && input.text.trim() !== "" ? input.text.trim() : null;
  const text = edited ?? item.draftedReply?.trim() ?? "";
  if (!text) return { status: "refused", reason: "no drafted reply: type one" };
  const problem = manualReplyProblem(text, deps.blocklist);
  if (problem) return { status: "refused", reason: problem };

  let actionId: string | null = null;
  if (existing) {
    // Shadow → planned (manual), one conditional update (same transition as promoteShadow, plus the edited text).
    const { rows } = await pool.query(
      `update engagement_actions set status = 'planned', origin = 'manual', not_before = $2, text = $3, updated_at = $2
        where id = $1 and status = 'shadow' returning id`,
      [existing.actionId, now, text],
    );
    actionId = (rows[0]?.id as string | undefined) ?? null;
    if (!actionId) {
      const again = await loadInboxItem(pool, id, now); // lost a race with another tap: report what won
      const a = again?.reply;
      if (a?.status === "sent") return { status: "sent", already: true, actionId: a.actionId, message: "already sent" };
      if (a && (a.status === "planned" || a.status === "sending")) return { status: "queued", already: true, dryRun: deps.dryRun, actionId: a.actionId, message: queuedMessage(deps.dryRun, true) };
      return { status: "refused", reason: "this reply changed meanwhile: reload" };
    }
  } else {
    const r = await createManualAction(pool as Pool, id, "reply", text, now);
    if (!r.ok) {
      const again = await loadInboxItem(pool, id, now);
      const a = again?.reply;
      if (a?.status === "sent") return { status: "sent", already: true, actionId: a.actionId, message: "already sent" };
      if (a) return { status: "queued", already: true, dryRun: deps.dryRun, actionId: a.actionId, message: queuedMessage(deps.dryRun, true) };
      return { status: "refused", reason: r.reason };
    }
    actionId = r.id;
  }
  await pool.query(`update comment_triage set handled_at = coalesce(handled_at, $2) where comment_id = $1`, [id, now]);
  await ackReplyReady(pool, id, input.sessionId, now);
  return { status: "queued", already: false, dryRun: deps.dryRun, actionId, message: queuedMessage(deps.dryRun, false) };
}

/** Server env → deps (DRY_RUN defaults on; only the literal "false" turns it off). Values are never logged. */
export function approveDepsFromEnv(pool: Pool, env: Record<string, string | undefined> = process.env): ApproveDeps {
  const kill = (env.ENGAGEMENT_KILL ?? "").trim().toLowerCase();
  return {
    pool,
    dryRun: (env.DRY_RUN ?? "true").trim().toLowerCase() !== "false",
    killEnv: kill === "1" || kill === "true",
    blocklist: (env.PRIVACY_BLOCKLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
