import PgBoss from "pg-boss";

/** One queue name per concern; the outbox/scheduler jobs land here in a later milestone. */
export const QUEUES = {
  health: "health-check",
} as const;

export function createQueue(databaseUrl: string): PgBoss {
  return new PgBoss({ connectionString: databaseUrl });
}
