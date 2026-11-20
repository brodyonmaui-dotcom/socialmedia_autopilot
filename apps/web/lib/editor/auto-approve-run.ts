// Fable to review
// "Editor approval counts" runner (server only). With the setting on, editor drafts whose render was approved
// in the editing chat are approved here without a second tap, through the SAME path as the calendar's
// "Approve & schedule": loadBatchFresh (fresh server-side warnings) → autoApproveDecision (the stricter gate)
// → planApproveSome (planTransition 'approve': block warnings, time, handed off) → PgBatchStore.apply.
// Each approval writes a distinguishable 'approve-editor' event (no session) and an 'auto-scheduled' alert
// in the same transaction. Safety:
//  - Off → returns before any item query.
//  - One runner at a time: pg_try_advisory_xact_lock on a constant key, held for the whole run; a second
//    process (or an overlapping tick) skips. apply's update is also conditional on status = 'draft'.
//  - Once only: an item with any 'approve-editor', 'unapprove', 'edit', 'reject' or 'reset-checked' event
//    is never auto-approved again, so pulling it back (reject / edit / move in the calendar) sticks.
import type { Pool } from "pg";
import { localClock12, localDate, weekdayIndex } from "@autopilot/core";
import type { BatchItemEventKind } from "@autopilot/db";
import { PgBatchStore, type ApplyExtra } from "../batches/pg-store.js";
import { ConflictError } from "../batches/store.js";
import type { BatchItemView } from "../batches/types.js";
import type { ItemChange } from "../batches/transitions.js";
import { loadBatchFresh } from "../calendar/load.js";
import { planApproveSome } from "../calendar/plan.js";
import { getEditorApprovalCounts } from "../settings/editor-approval.js";
import { autoApproveDecision } from "./auto-approve.js";
import { firstLines } from "./view.js";

/** Advisory lock key text (hashtext'd in SQL, same style as the ingest's 'batch-week:' locks). */
export const AUTO_APPROVE_LOCK = "editor-auto-approve";
const EVENT: BatchItemEventKind = "approve-editor";
/** History that rules an item out for good (see header). */
const DONE_EVENTS: readonly BatchItemEventKind[] = ["approve-editor", "unapprove", "edit", "reject", "reset-checked"];

export const AUTO_APPROVE_SQL = {
  candidates: `select bi.id, bi.batch_id from batch_items bi
                where bi.origin = 'editor' and bi.status = 'draft' and bi.platform <> 'snapchat'
                  and bi.scheduled_for is not null and bi.scheduled_for > $1
                  and not exists (select 1 from batch_item_events e where e.batch_item_id = bi.id and e.kind = any($2::text[]))
                order by bi.batch_id, bi.id
                limit 200`,
} as const;

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** The YouTube title, else the caption's first line (≤ 60 chars), else the clip label. */
export function itemTitle(item: Pick<BatchItemView, "platform" | "title" | "caption" | "media">): string {
  const yt = item.platform === "youtube" ? item.title?.trim() : "";
  const t = yt || firstLines(item.caption, 1)[0] || item.media.label;
  return t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t;
}

/** "Scheduled: <title> at 6:30 PM" today, "Scheduled: <title> at Tue 9:30 AM" on any other day (creator zone). */
export function scheduledMessage(item: Pick<BatchItemView, "platform" | "title" | "caption" | "media" | "scheduledFor">, now: Date, timeZone: string): string {
  const at = new Date(item.scheduledFor ?? Number.NaN);
  const day = localDate(at, timeZone);
  const time = localClock12(at, timeZone);
  const when = day === localDate(now, timeZone) ? time : `${WEEKDAY[weekdayIndex(day)]} ${time}`;
  return `Scheduled: ${itemTitle(item)} at ${when}`;
}

export async function runEditorAutoApprove(pool: Pool, now: Date, tz: string): Promise<{ approved: number }> {
  if (!(await getEditorApprovalCounts(pool))) return { approved: 0 };

  const lock = await pool.connect();
  let approved = 0;
  try {
    await lock.query("begin");
    const got = await lock.query(`select pg_try_advisory_xact_lock(hashtext($1)) as ok`, [AUTO_APPROVE_LOCK]);
    if (got.rows[0]?.ok !== true) {
      await lock.query("rollback");
      return { approved: 0 };
    }
    // Re-read under the lock: switched off a moment ago means nothing happens.
    if (!(await getEditorApprovalCounts(pool))) {
      await lock.query("rollback");
      return { approved: 0 };
    }

    const { rows } = await pool.query(AUTO_APPROVE_SQL.candidates, [now, DONE_EVENTS]);
    const byBatch = new Map<string, Set<string>>();
    for (const r of rows as Array<{ id: string; batch_id: string }>) (byBatch.get(r.batch_id) ?? byBatch.set(r.batch_id, new Set()).get(r.batch_id)!).add(r.id);

    const env = { ...process.env, TZ_CREATOR: tz };
    const store = new PgBatchStore(pool);
    for (const [batchId, ids] of byBatch) {
      const fresh = await loadBatchFresh(pool, batchId, now, env);
      if (!fresh) continue;
      const { batch } = fresh;
      const ok = batch.items.filter((i) => ids.has(i.id) && autoApproveDecision(i, i.warnings, { approvalCounts: true, now }).approve);
      if (ok.length === 0) continue;

      const plan = planApproveSome(batch, ok.map((i) => i.id), now);
      if (plan.changes.length === 0) continue;
      const byId = new Map(ok.map((i) => [i.id, i]));
      const changes: ItemChange[] = [];
      const alerts: NonNullable<ApplyExtra["alerts"]> = [];
      for (const c of plan.changes) {
        const item = byId.get(c.itemId);
        // planApproveSome only approves what it was given, all from draft; anything else is refused outright.
        if (!item || c.from !== "draft" || c.to !== "approved") throw new Error("auto-approve: unexpected plan");
        changes.push({ ...c, eventKind: EVENT, detail: { source: item.editor?.source ?? null, approvedInEditor: item.editor?.approvedInEditorAt ?? null } });
        alerts.push({ kind: "auto-scheduled", batchItemId: item.id, platform: item.platform, message: scheduledMessage(item, now, tz) });
      }
      try {
        await store.apply(batchId, changes, plan.batchStatus, null, now, { alerts });
        approved += changes.length;
      } catch (err) {
        if (err instanceof ConflictError) continue; // changed underneath: the next tick re-reads it
        throw err;
      }
    }
    await lock.query("commit");
    return { approved };
  } catch (err) {
    await lock.query("rollback").catch(() => {});
    throw err;
  } finally {
    lock.release();
  }
}
