/** F20 stream D: settings key 'instagram_daily_min' = jsonb integer, the fewest Instagram posts a day the daily top-up aims for. */
export const INSTAGRAM_DAILY_MIN_KEY = "instagram_daily_min";
export const INSTAGRAM_DAILY_MIN_DEFAULT = 2;
export const INSTAGRAM_DAILY_MIN_MAX = 6;

/** Pure: stored value → 0..6; no row or anything that isn't a whole number in range reads as the default. */
export function parseInstagramDailyMin(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= INSTAGRAM_DAILY_MIN_MAX ? value : INSTAGRAM_DAILY_MIN_DEFAULT;
}
