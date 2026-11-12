import type PgBoss from "pg-boss";
import type { Pool } from "pg";
import { QUEUES } from "../queue.js";
import { runOutboxOnce, type OutboxConfig } from "./outbox.js";

export async function registerOutboxJob(boss: PgBoss, pool: Pool, cfg: OutboxConfig): Promise<void> {
  await boss.createQueue(QUEUES.outboxTick);
  await boss.work(QUEUES.outboxTick, async () => {
    const r = await runOutboxOnce(pool, cfg);
    if (r.considered || r.recovered || r.unknown) {
      console.log(
        `[outbox] tick: considered ${r.considered} · published ${r.published} (${r.recovered} recovered) · queued ${r.queued} · failed ${r.failed} · unknown ${r.unknown} · skipped ${r.skipped}${r.dryRun ? " (dry-run)" : ""}`,
      );
    }
  });
  // Every minute: Instagram fires at scheduled_for; YouTube/TikTok are handed off ahead of time; retries wake on next_attempt_at.
  await boss.schedule(QUEUES.outboxTick, "* * * * *");
}
