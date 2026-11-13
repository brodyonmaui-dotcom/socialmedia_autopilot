// Engagement send (F3): one runSendTick over due planned actions. Two keys, like the outbox: nothing
// leaves unless dry-run is off AND the worker was started with its live key; the send gate then still
// checks mode, kill switch, caps and the veto window per row.
import {
  killEnvFromEnv,
  runSendTick,
  type CommentSource,
  type EngagementAlertSink,
  type EngagementPlatform,
  type EngagementStore,
  type EngagementSettings,
  type SendTickResult,
} from "@autopilot/engagement";
import type { OutboxPool } from "./outbox.js";
import { PgEngagementStore } from "./engagement-store.js";

export interface EngagementSendConfig {
  dryRun: boolean;
  /** The worker's second key (argv flag or WORKER_LIVE=1), read in index.ts. */
  live: boolean;
  log?: (line: string) => void;
  /** Defaults to killEnvFromEnv() (ENGAGEMENT_KILL). */
  killEnv?: boolean;
  now?: () => Date;
}

export type SendStore = EngagementStore & { loadSettings(): Promise<EngagementSettings> };

/** The row is already in `alerts` (store.recordAlert); this just puts it in the worker log. */
export const consoleEngagementAlertSink: EngagementAlertSink = {
  async send(alert) {
    console.log(`[alert] ${alert.kind} ${alert.platform}${alert.actionId ? ` action ${alert.actionId}` : ""}: ${alert.message}`);
  },
};

export async function runEngagementSendWith(store: SendStore, sources: Map<EngagementPlatform, CommentSource>, cfg: EngagementSendConfig): Promise<SendTickResult> {
  const settings = await store.loadSettings();
  return runSendTick(store, sources, {
    settings,
    dryRun: cfg.dryRun || !cfg.live,
    killEnv: cfg.killEnv ?? killEnvFromEnv(),
    alerts: consoleEngagementAlertSink,
    log: cfg.log ?? console.log,
    ...(cfg.now ? { now: cfg.now } : {}),
  });
}

export async function runEngagementSendOnce(pool: OutboxPool, sources: Map<EngagementPlatform, CommentSource>, cfg: EngagementSendConfig): Promise<SendTickResult> {
  return runEngagementSendWith(new PgEngagementStore(pool), sources, cfg);
}
