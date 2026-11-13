import PgBoss from "pg-boss";

/** One queue name per concern. */
export const QUEUES = {
  health: "health-check",
  outboxTick: "outbox-tick",
  tokenHealth: "token-health",
  engagementPoll: "engagement-poll",
  engagementTriage: "engagement-triage",
  engagementSend: "engagement-send",
  dmPoll: "dm-poll",
  analyticsIngest: "analytics-ingest",
  alertPush: "alert-push",
} as const;

export function createQueue(databaseUrl: string): PgBoss {
  return new PgBoss({ connectionString: databaseUrl });
}
