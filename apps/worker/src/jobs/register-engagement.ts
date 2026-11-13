// Registers the four engagement queues (F3). deploy.md gotcha: createQueue before work/schedule,
// otherwise pg-boss 10 drops the schedule.
import {
  createAnthropicTriageClient,
  createFakeTriageClient,
  type CommentSource,
  type DmSource,
  type EngagementPlatform,
  type EngagementSettings,
  type TriageClient,
} from "@autopilot/engagement";
import { QUEUES } from "../queue.js";
import type { OutboxPool } from "./outbox.js";
import { runDmPollOnce } from "./dm-poll.js";
import { ENGAGEMENT_PLATFORMS, runEngagementPollOnce } from "./engagement-poll.js";
import { runEngagementSendOnce } from "./engagement-send.js";
import { runEngagementTriageOnce } from "./engagement-triage.js";

/** The slice of PgBoss used here, so tests can pass a recording fake. */
export interface BossLike {
  createQueue(name: string): Promise<unknown>;
  work(name: string, handler: (jobs: unknown) => Promise<unknown>): Promise<unknown>;
  schedule(name: string, cron: string): Promise<unknown>;
}

export interface EngagementJobsConfig {
  sources: Map<EngagementPlatform, CommentSource>;
  dmSource: DmSource | null;
  igUserId?: string | null;
  triage: TriageClient;
  /** Only a real model (null = DM drafts from templates/rules alone). */
  dmTriage?: TriageClient | null;
  blocklist: string[];
  dryRun: boolean;
  live: boolean;
  log?: (line: string) => void;
}

export const ENGAGEMENT_SCHEDULES = [
  [QUEUES.engagementPoll, "*/5 * * * *"],
  [QUEUES.engagementTriage, "* * * * *"],
  [QUEUES.engagementSend, "* * * * *"],
  [QUEUES.dmPoll, "*/5 * * * *"],
] as const;

/** Same parsing as @autopilot/research blocklistFromEnv (PRIVACY_BLOCKLIST, comma separated; .env only). */
export function blocklistFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  return (env.PRIVACY_BLOCKLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Flags everything: without a model key nothing is ever auto-replied, the inbox gets every comment. */
export const FLAG_ALL_RULES: Parameters<typeof createFakeTriageClient>[0] = [[/[\s\S]*/, "flag", null, 1]];

/** ANTHROPIC_API_KEY → Claude triage; otherwise rules only (every comment flagged). Never logs the key. */
export function triageClientFromEnv(env: Record<string, string | undefined> = process.env, log: (line: string) => void = console.log): TriageClient {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) return createAnthropicTriageClient({ apiKey, ...(env.ANTHROPIC_MODEL ? { model: env.ANTHROPIC_MODEL } : {}), log });
  log("triage: rules only (no ANTHROPIC_API_KEY)");
  return createFakeTriageClient(FLAG_ALL_RULES);
}

/** `engagement modes: instagram=shadow youtube=shadow tiktok=off · live=false · killEnv=false` */
export function engagementStartupLine(settings: EngagementSettings, live: boolean, killEnv: boolean): string {
  const modes = ENGAGEMENT_PLATFORMS.map((p) => `${p}=${settings.mode[p]}`).join(" ");
  return `engagement modes: ${modes} · live=${live} · killEnv=${killEnv}${settings.killed ? ` · killed (${settings.killedReason ?? "no reason"})` : ""}`;
}

export async function registerEngagementJobs(boss: BossLike, pool: OutboxPool, cfg: EngagementJobsConfig): Promise<void> {
  const log = cfg.log ?? console.log;
  const handlers: Record<(typeof ENGAGEMENT_SCHEDULES)[number][0], () => Promise<unknown>> = {
    [QUEUES.engagementPoll]: () => runEngagementPollOnce(pool, cfg.sources, log),
    [QUEUES.engagementTriage]: () => runEngagementTriageOnce(pool, cfg.triage, { blocklist: cfg.blocklist, log }),
    [QUEUES.engagementSend]: async () => {
      const r = await runEngagementSendOnce(pool, cfg.sources, { dryRun: cfg.dryRun, live: cfg.live, log });
      if (r.sent || r.failed || r.unknown || r.retried || r.killedNow) {
        log(`[engage] send tick: considered ${r.considered} · sent ${r.sent} · retried ${r.retried} · failed ${r.failed} · unknown ${r.unknown}${r.killedNow ? ` · KILLED: ${r.killedNow}` : ""}`);
      }
    },
    [QUEUES.dmPoll]: () => runDmPollOnce(pool, cfg.dmSource, cfg.dmTriage ?? null, log, new Date(), { igUserId: cfg.igUserId ?? null, blocklist: cfg.blocklist }),
  };
  for (const [name, cron] of ENGAGEMENT_SCHEDULES) {
    await boss.createQueue(name);
    await boss.work(name, async () => {
      await handlers[name]();
    });
    await boss.schedule(name, cron);
  }
}
