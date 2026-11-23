// Settings key 'touchup_autofix' = jsonb boolean, ON by default (no row or anything but exactly false reads as on).
// The worker queues a Touch-up fix right after QA flags a fixable issue; originals are never changed and keeping
// the fix stays the creator's tap. Turning it off only stops new automatic queueing.
import type { Pool } from "pg";
import { getSetting, setSetting } from "@autopilot/db";
import { writeSettingsAudit } from "./audit.js";

export const TOUCHUP_AUTOFIX_KEY = "touchup_autofix";

export const parseTouchupAutofix = (value: unknown): boolean => value !== false;

export async function getTouchupAutofix(pool: Pool): Promise<boolean> {
  return parseTouchupAutofix(await getSetting<unknown>(pool, TOUCHUP_AUTOFIX_KEY));
}

export async function setTouchupAutofix(pool: Pool, on: boolean): Promise<{ before: boolean; after: boolean }> {
  const before = await getTouchupAutofix(pool);
  const after = on === true;
  if (before !== after) {
    await setSetting(pool, TOUCHUP_AUTOFIX_KEY, after);
    await writeSettingsAudit(pool, `Touch-up auto-fix: ${after ? "on" : "off"}`);
  }
  return { before, after };
}
