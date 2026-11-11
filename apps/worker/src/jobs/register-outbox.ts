import type PgBoss from "pg-boss";
import type { Pool } from "pg";
import { QUEUES } from "../queue.js";
import { runOutboxOnce, type OutboxConfig } from "./outbox.js";

export async function registerOutboxJob(boss: PgBoss, pool: Pool, cfg: OutboxConfig): Promise<void> {
  await boss.createQueue(QUEUES.outboxTick);
  await boss.work(QUEUES.outboxTick, async () => {
    const { processed, dryRun } = await runOutboxOnce(pool, cfg);
    if (processed) console.log(`[outbox] tick: ${processed} item(s) ${dryRun ? "(dry-run)" : "processed"}`);
  });
  await boss.schedule(QUEUES.outboxTick, "* * * * *"); // every minute: native-scheduling platforms fire as soon as approved
}
