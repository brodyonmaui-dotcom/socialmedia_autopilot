import type { Platform } from "@autopilot/core";
import type { IngestResult } from "./ingest.js";

/**
 * Metrics-source health across ingest runs (pure). A run "fails" for a platform when it attempted
 * at least one fetch there and every attempt failed; any success resets the counter. Platforms not
 * attempted this run keep their state unchanged (nothing due is not a failure).
 * Kept in the settings KV under METRICS_HEALTH_KEY by the worker.
 */
export const METRICS_FAIL_THRESHOLD = 3;
export const METRICS_HEALTH_KEY = "metrics_health";
/** Alert kind for a metrics source that failed METRICS_FAIL_THRESHOLD runs in a row (page-only, not pushed). */
export const METRICS_HEALTH_KIND = "metrics-health" as const;

export interface MetricsHealthState {
  [platform: string]: { consecutive: number; lastOkAt: string | null };
}

export function nextHealth(
  prev: MetricsHealthState,
  res: Pick<IngestResult, "attemptedByPlatform" | "failedByPlatform">,
  now: Date,
): { state: MetricsHealthState; trip: Platform[]; recovered: Platform[] } {
  const state: MetricsHealthState = {};
  for (const [k, v] of Object.entries(prev ?? {})) state[k] = { consecutive: v?.consecutive ?? 0, lastOkAt: v?.lastOkAt ?? null };
  const trip: Platform[] = [];
  const recovered: Platform[] = [];
  for (const [platform, attempted] of Object.entries(res.attemptedByPlatform) as Array<[Platform, number | undefined]>) {
    if (!attempted) continue;
    const failed = res.failedByPlatform[platform] ?? 0;
    const before = state[platform] ?? { consecutive: 0, lastOkAt: null };
    if (failed >= attempted) {
      const consecutive = before.consecutive + 1;
      state[platform] = { consecutive, lastOkAt: before.lastOkAt };
      if (consecutive === METRICS_FAIL_THRESHOLD) trip.push(platform);
    } else {
      if (before.consecutive >= METRICS_FAIL_THRESHOLD) recovered.push(platform);
      state[platform] = { consecutive: 0, lastOkAt: now.toISOString() };
    }
  }
  return { state, trip, recovered };
}
