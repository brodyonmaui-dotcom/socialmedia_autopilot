// Settings key 'ig_trial_reels' = jsonb boolean, OFF by default (only exactly true reads as on). The worker reads it per outbox tick and
// publishes Instagram reels as trial reels (MANUAL graduation) only when it is on AND followers >= trial_reels_min_followers (default 200).
import type { Pool } from "pg";
import { IG_TRIAL_REELS_KEY, TRIAL_REELS_MIN_FOLLOWERS_DEFAULT, TRIAL_REELS_MIN_FOLLOWERS_KEY } from "@autopilot/core";
import { getSetting, setSetting } from "@autopilot/db";
import { writeSettingsAudit } from "./audit.js";

export interface IgTrialView {
  on: boolean;
  followers: number | null;
  min: number;
}

export async function getIgTrialReels(pool: Pool): Promise<IgTrialView> {
  const on = (await getSetting<unknown>(pool, IG_TRIAL_REELS_KEY)) === true;
  const m = await getSetting<unknown>(pool, TRIAL_REELS_MIN_FOLLOWERS_KEY);
  const min = typeof m === "number" && Number.isInteger(m) && m > 0 ? m : TRIAL_REELS_MIN_FOLLOWERS_DEFAULT;
  const { rows } = await pool.query(`select followers from account_snapshots where platform = 'instagram' and followers is not null order by captured_on desc limit 1`);
  return { on, followers: rows[0]?.followers == null ? null : Number(rows[0].followers), min };
}

export async function setIgTrialReels(pool: Pool, on: boolean): Promise<{ before: boolean; after: boolean }> {
  const before = (await getSetting<unknown>(pool, IG_TRIAL_REELS_KEY)) === true;
  const after = on === true;
  if (before !== after) {
    await setSetting(pool, IG_TRIAL_REELS_KEY, after);
    await writeSettingsAudit(pool, `Instagram trial reels: ${after ? "on" : "off"}`, "instagram");
  }
  return { before, after };
}
