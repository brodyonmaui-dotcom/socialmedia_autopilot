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
  weeklyDraft: "weekly-draft",
  dailyInstagram: "daily-instagram",
  weeklyReport: "weekly-report",
  /** F20 E "Make a reel": one queued media_edits row per minute. */
  mediaReel: "media-reel-tick",
  /** F23 browser upload: one 'uploaded' uploads row per minute → strip → Library. */
  mediaIngest: "media-ingest-tick",
} as const;

export function createQueue(databaseUrl: string): PgBoss {
  return new PgBoss({ connectionString: databaseUrl });
}
