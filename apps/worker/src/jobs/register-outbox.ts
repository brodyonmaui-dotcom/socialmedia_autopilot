import type PgBoss from "pg-boss";
import type { Pool } from "pg";
import type { TickResult } from "@autopilot/core";
import { QUEUES } from "../queue.js";
import { runOutboxOnce, type OutboxConfig } from "./outbox.js";
import { tickStatus, writeWorkerStatus, type HeartbeatInfo } from "./heartbeat.js";

/** The one summary line per tick (missed posts are counted here, never logged per item: the guard repeats every minute). Null = nothing to say. */
export function tickSummaryLine(r: TickResult): string | null {
  if (!(r.considered || r.recovered || r.unknown || r.missed)) return null;
  return `[outbox] tick: considered ${r.considered} · published ${r.published} (${r.recovered} recovered) · queued ${r.queued} · failed ${r.failed} · unknown ${r.unknown} · skipped ${r.skipped} · missed ${r.missed}${r.dryRun ? " (dry-run)" : ""}`;
}

/**
 * `heartbeat` (F18): when given, every completed tick upserts settings.worker_status. A tick that throws
 * writes none, so the banner goes stale. `runTick` is injectable for tests.
 */
export async function registerOutboxJob(
  boss: PgBoss,
  pool: Pool,
  cfg: OutboxConfig,
  heartbeat?: HeartbeatInfo,
  runTick: (pool: Pool, cfg: OutboxConfig) => Promise<TickResult> = runOutboxOnce,
): Promise<void> {
  await boss.createQueue(QUEUES.outboxTick);
  await boss.work(QUEUES.outboxTick, async () => {
    const r = await runTick(pool, cfg);
    const line = tickSummaryLine(r);
    if (line) console.log(line);
    if (heartbeat) await writeWorkerStatus(pool, tickStatus(heartbeat, r, cfg.now?.() ?? new Date()));
  });
  // Every minute: Instagram fires at scheduled_for; YouTube/TikTok are handed off ahead of time; retries wake on next_attempt_at.
  // singletonKey is accepted by pg-boss 10.4.2's schedule() (ScheduleOptions = SendOptions & { tz }) and
  // passed through to each cron-sent job. On this standard-policy queue it does NOT dedupe on its own
  // (pg-boss only enforces it for short/singleton/stately queues or with singletonSeconds), so it is a
  // label/hint only. The authoritative guard is the advisory lock in runOutboxWith (OUTBOX_LOCK_KEY).
  await boss.schedule(QUEUES.outboxTick, "* * * * *", undefined, { singletonKey: "outbox-tick" });
}
