import { IG_TRIAL_REELS_KEY, TRIAL_REELS_ALERTED_KEY, TRIAL_REELS_MIN_FOLLOWERS_DEFAULT, TRIAL_REELS_MIN_FOLLOWERS_KEY } from "@autopilot/core";
import { getSetting, setSetting } from "@autopilot/db";
import type { OutboxPool } from "./outbox.js";

/**
 * F20-F: Instagram trial reels, ready for when the account reaches the follower minimum (200, to probe: research.md).
 *  - checkTrialReelsReady(): after account-ingest stores the follower count, raise ONE 'trial-reels-ready' alert the first time
 *    followers >= trial_reels_min_followers (remembered in settings.trial_reels_alerted, so never twice).
 *  - igTrialDefault(): read per outbox tick. Null (plain reels) unless Settings ig_trial_reels is on AND followers >= minimum.
 *    Only posts whose batch item sets no trial of its own get it; a refusal still falls back to a regular reel in the adapter.
 */
type Q = Pick<OutboxPool, "query">;

export const TRIAL_REELS_READY_MESSAGE = (min: number): string => `Instagram reached ${min} followers: trial reels can be turned on in Settings.`;

export async function latestInstagramFollowers(pool: Q): Promise<number | null> {
  const { rows } = await pool.query(`select followers from account_snapshots where platform = 'instagram' and followers is not null order by captured_on desc limit 1`);
  const n = rows[0]?.followers;
  return n == null ? null : Number(n);
}

export async function trialReelsMinFollowers(pool: Q): Promise<number> {
  const v = await getSetting<unknown>(pool, TRIAL_REELS_MIN_FOLLOWERS_KEY);
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : TRIAL_REELS_MIN_FOLLOWERS_DEFAULT;
}

/** True when this call raised the alert. */
export async function checkTrialReelsReady(pool: Q, now: Date, log: (l: string) => void = console.log): Promise<boolean> {
  if ((await getSetting<unknown>(pool, TRIAL_REELS_ALERTED_KEY)) === true) return false;
  const followers = await latestInstagramFollowers(pool);
  const min = await trialReelsMinFollowers(pool);
  if (followers === null || followers < min) return false;
  await pool.query(`insert into alerts (kind, batch_item_id, platform, message, created_at) values ('trial-reels-ready', null, 'instagram', $1, $2)`, [TRIAL_REELS_READY_MESSAGE(min), now.toISOString()]);
  await setSetting(pool, TRIAL_REELS_ALERTED_KEY, true);
  log(`[account] trial-reels-ready: instagram at ${followers} followers (min ${min}); alert raised`);
  return true;
}

/** The default graduation strategy for plain Instagram reels this tick, or null. MANUAL = graduate in the app (decisions.md #5). */
export async function igTrialDefault(pool: Q): Promise<"MANUAL" | null> {
  if ((await getSetting<unknown>(pool, IG_TRIAL_REELS_KEY)) !== true) return null;
  const followers = await latestInstagramFollowers(pool);
  if (followers === null || followers < (await trialReelsMinFollowers(pool))) return null;
  return "MANUAL";
}
