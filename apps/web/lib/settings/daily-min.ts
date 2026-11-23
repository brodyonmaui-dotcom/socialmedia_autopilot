// Settings key 'instagram_daily_min' = jsonb integer 0..6, default 2 (no row or anything else reads as the default).
// The worker's daily-instagram job tops tomorrow up to this many Instagram drafts; it never approves anything.
import type { Pool } from "pg";
import { INSTAGRAM_DAILY_MIN_DEFAULT, INSTAGRAM_DAILY_MIN_KEY, INSTAGRAM_DAILY_MIN_MAX, parseInstagramDailyMin } from "@autopilot/core";
import { getSetting, setSetting } from "@autopilot/db";
import { writeSettingsAudit } from "./audit.js";

export const DAILY_MIN_LIMITS = { min: 0, max: INSTAGRAM_DAILY_MIN_MAX, default: INSTAGRAM_DAILY_MIN_DEFAULT } as const;

export async function getInstagramDailyMin(pool: Pool): Promise<number> {
  return parseInstagramDailyMin(await getSetting<unknown>(pool, INSTAGRAM_DAILY_MIN_KEY));
}

/** Pure: the form field → a whole number 0..6, or the problem. */
export function parseDailyMinForm(raw: string | null): { ok: true; value: number } | { ok: false; error: string } {
  const t = (raw ?? "").trim();
  if (!/^\d{1,2}$/.test(t) || Number(t) > INSTAGRAM_DAILY_MIN_MAX) return { ok: false, error: `Instagram minimum: enter a whole number from 0 to ${INSTAGRAM_DAILY_MIN_MAX}` };
  return { ok: true, value: Number(t) };
}

export async function setInstagramDailyMin(pool: Pool, value: number): Promise<{ before: number; after: number; message: string }> {
  if (!Number.isInteger(value) || value < 0 || value > INSTAGRAM_DAILY_MIN_MAX) throw new RangeError(`Instagram minimum: 0..${INSTAGRAM_DAILY_MIN_MAX}`);
  const before = await getInstagramDailyMin(pool);
  if (before === value) return { before, after: value, message: "" };
  await setSetting(pool, INSTAGRAM_DAILY_MIN_KEY, value);
  const message = `Instagram daily minimum ${before}→${value}`;
  await writeSettingsAudit(pool, message, "instagram");
  return { before, after: value, message };
}
