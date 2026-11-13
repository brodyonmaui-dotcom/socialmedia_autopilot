// Kill switch (F3): auto-trip on repeated failures or a platform block/limit signal; env override.

/** Errors that mean "stop now": the platform (or our AI/billing) is pushing back. */
export const KILL_PATTERN = /action.?block|spam|rate.?limit|too many|temporarily blocked|checkpoint|insufficient_quota|credit balance|billing/i;

/**
 * `recent` is newest first. Returns why the kill switch should trip, or null.
 *  - the newest outcome's error matches KILL_PATTERN → "platform block/limit signal: <match>"
 *    (only the head is scanned: an old block signal must not re-trip the switch after a human resets it)
 *  - 3 consecutive failures at the head → "3 consecutive send failures"
 */
export function shouldTripKill(recent: Array<{ ok: boolean; error?: string }>): string | null {
  const newest = recent[0];
  const m = newest && !newest.ok && newest.error ? KILL_PATTERN.exec(newest.error) : null;
  if (m) return `platform block/limit signal: ${m[0]}`;
  const head = recent.slice(0, 3);
  if (head.length === 3 && head.every((r) => !r.ok)) return "3 consecutive send failures";
  return null;
}

/** `ENGAGEMENT_KILL=1|true` stops every send regardless of settings. */
export function killEnvFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.ENGAGEMENT_KILL?.trim().toLowerCase();
  return v === "1" || v === "true";
}
