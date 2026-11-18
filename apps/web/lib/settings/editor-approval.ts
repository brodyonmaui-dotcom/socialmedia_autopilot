// Fable to review
// Settings key 'editor' = {"approvalCounts": boolean}, OFF by default (no row, a malformed row, or anything
// but exactly true reads as off). Turning it on lets lib/editor/auto-approve-run.ts schedule editor renders
// without a second tap here, so the read is strict and every change writes the settings audit row.
import type { Pool } from "pg";
import { getSetting } from "@autopilot/db";
import { writeSettingsAudit } from "./audit.js";

export const EDITOR_SETTING_KEY = "editor";

type Overlay = Record<string, unknown>;
const isObj = (v: unknown): v is Overlay => typeof v === "object" && v !== null && !Array.isArray(v);

/** Pure: the stored value → on/off. Only `{ approvalCounts: true }` is on. */
export function parseEditorApprovalCounts(value: unknown): boolean {
  return isObj(value) && value.approvalCounts === true;
}

export async function getEditorApprovalCounts(pool: Pool): Promise<boolean> {
  return parseEditorApprovalCounts(await getSetting<unknown>(pool, EDITOR_SETTING_KEY));
}

/**
 * Row-locked read-modify-write (like setDmDrafts / updateEngagement): other keys in the 'editor' row are kept.
 * The audit row ("Editor approval counts: on/off") is written in the same transaction, only when the value changed.
 */
export async function setEditorApprovalCounts(pool: Pool, on: boolean): Promise<{ before: boolean; after: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`insert into settings (key, value, updated_at) values ($1, '{}'::jsonb, now()) on conflict (key) do nothing`, [EDITOR_SETTING_KEY]);
    const { rows } = await client.query("select value from settings where key = $1 for update", [EDITOR_SETTING_KEY]);
    const raw: unknown = rows[0]?.value;
    const before = parseEditorApprovalCounts(raw);
    const after = on === true;
    if (before !== after) {
      const next = { ...(isObj(raw) ? raw : {}), approvalCounts: after };
      await client.query("update settings set value = $2::jsonb, updated_at = now() where key = $1", [EDITOR_SETTING_KEY, JSON.stringify(next)]);
      await writeSettingsAudit(client, `Editor approval counts: ${after ? "on" : "off"}`);
    }
    await client.query("commit");
    return { before, after };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
