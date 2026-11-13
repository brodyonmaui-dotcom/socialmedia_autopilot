// Engagement poll (F3): fetch recent comments per platform into `comments`. Read-only on the platforms.
import { redactSecrets, type CommentSource, type EngagementPlatform } from "@autopilot/engagement";
import type { OutboxPool } from "./outbox.js";
import { PgEngagementStore, type EngagementJobStore } from "./engagement-store.js";

export const ENGAGEMENT_PLATFORMS: readonly EngagementPlatform[] = ["instagram", "youtube", "tiktok"];
const DEFAULT_POLL_MIN = 15; // platforms without a pollMinutes entry (TikTok)

export type PollStore = Pick<EngagementJobStore, "loadSettings" | "getCursor" | "setCursor" | "upsertComments">;
export type PollOutcome = { fetched: number; inserted: number } | { error: string } | { skipped: string };
export type PollResult = Partial<Record<EngagementPlatform, PollOutcome>>;

const errMessage = (err: unknown): string => redactSecrets((err as Error | undefined)?.message ?? String(err));

/** Pure part: one pass over the platforms with a store. One platform failing never stops the others. */
export async function runEngagementPollWith(
  store: PollStore,
  sources: Map<EngagementPlatform, CommentSource>,
  log: (line: string) => void = console.log,
  now: Date = new Date(),
): Promise<PollResult> {
  const settings = await store.loadSettings();
  const out: PollResult = {};
  for (const p of ENGAGEMENT_PLATFORMS) {
    const source = sources.get(p);
    if (settings.mode[p] === "off" || !source) continue;
    try {
      const prev = await store.getCursor(p);
      const everyMin = (settings.pollMinutes as Partial<Record<EngagementPlatform, number>>)[p] ?? DEFAULT_POLL_MIN;
      if (prev?.polledAt && now.getTime() - prev.polledAt.getTime() < everyMin * 60_000) {
        out[p] = { skipped: "not due" };
        continue;
      }
      const { comments, cursor } = await source.fetchRecent(prev?.cursor ?? null);
      const inserted = await store.upsertComments(comments, now);
      await store.setCursor(p, cursor, now);
      out[p] = { fetched: comments.length, inserted };
      if (comments.length) log(`[engage] poll ${p}: fetched ${comments.length} · new ${inserted}`);
    } catch (err) {
      const message = errMessage(err);
      out[p] = { error: message };
      log(`[engage] poll ${p} FAILED: ${message}`);
    }
  }
  return out;
}

export async function runEngagementPollOnce(
  pool: OutboxPool,
  sources: Map<EngagementPlatform, CommentSource>,
  log: (line: string) => void = console.log,
  now: Date = new Date(),
): Promise<PollResult> {
  return runEngagementPollWith(new PgEngagementStore(pool), sources, log, now);
}
