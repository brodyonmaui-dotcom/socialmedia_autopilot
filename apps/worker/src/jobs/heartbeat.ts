import { sanitizeError, type TickResult } from "@autopilot/core";
import { setSetting, type SettingsPool } from "@autopilot/db";

/**
 * F18 worker heartbeat: settings row `worker_status`, upserted at startup and at the end of every
 * outbox tick. The web posting-status banner reads it (parsed defensively there, with its own type)
 * to tell "dry run" / "live" / "worker silent". No secrets, no zone name: `reason` is the run-mode
 * refusal text or the TZ_CREATOR-missing notice, both fixed strings.
 */
export const WORKER_STATUS_KEY = "worker_status";

export interface WorkerStatus {
  mode: "live" | "dry-run";
  reason: string | null;
  startedAt: string;
  lastTickAt: string;
  /** Approved posts the last tick held as missed (the banner recounts in SQL; this is informational). */
  missed: number;
  /** Posts the last tick tried to send (due, not missed). */
  dueNow: number;
}

/** Fixed per process: decided once at startup. */
export interface HeartbeatInfo {
  dryRun: boolean;
  reason: string | null;
  startedAt: string;
}

export function startupStatus(info: HeartbeatInfo): WorkerStatus {
  return { mode: info.dryRun ? "dry-run" : "live", reason: info.reason, startedAt: info.startedAt, lastTickAt: info.startedAt, missed: 0, dueNow: 0 };
}

export function tickStatus(info: HeartbeatInfo, r: Pick<TickResult, "considered" | "missed">, at: Date): WorkerStatus {
  return { ...startupStatus(info), lastTickAt: at.toISOString(), missed: r.missed, dueNow: Math.max(0, r.considered - r.missed) };
}

/**
 * Upsert the row. Never throws: a failed heartbeat must not fail the tick (the posts are already
 * handled); the banner goes stale instead, which is the right signal. One line per failure.
 */
export async function writeWorkerStatus(pool: SettingsPool, status: WorkerStatus, log: (line: string) => void = (l) => console.log(l)): Promise<boolean> {
  try {
    await setSetting(pool, WORKER_STATUS_KEY, status);
    return true;
  } catch (err) {
    log(`[heartbeat] could not write ${WORKER_STATUS_KEY}: ${sanitizeError(err)}`);
    return false;
  }
}
