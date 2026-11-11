import type PgBoss from "pg-boss";
import { QUEUES } from "../queue.js";

/** Proves the worker + Postgres + pg-boss wiring is alive. Real jobs (outbox, scheduler) arrive in M1. */
export async function registerHealthJob(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUES.health); // pg-boss v10: schedule()/work() need the queue to already exist
  await boss.work(QUEUES.health, async () => {
    console.log(`[health] ok at ${new Date().toISOString()}`);
  });
  await boss.schedule(QUEUES.health, "*/5 * * * *");
}
