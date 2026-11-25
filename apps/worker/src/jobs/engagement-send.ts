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
  type EngagementStatus,
  type SendTickResult,
} from "@autopilot/engagement";
import type { OutboxPool } from "./outbox.js";
import { PgEngagementStore, type ReplyStatusFacts } from "./engagement-store.js";
import { ENGAGEMENT_PLATFORMS } from "./engagement-poll.js";

export interface EngagementSendConfig {
  dryRun: boolean;
  /** The worker's second key (argv flag or WORKER_LIVE=1), read in index.ts. */
  live: boolean;
  log?: (line: string) => void;
  /** Defaults to killEnvFromEnv() (ENGAGEMENT_KILL). */
  killEnv?: boolean;
  now?: () => Date;
}

export type SendStore = EngagementStore & {
  loadSettings(): Promise<EngagementSettings>;
  /** Optional so older fakes keep working: the reply status the web reads (settings.engagement_status). */
  replyStatusFacts?(): Promise<ReplyStatusFacts>;
  saveEngagementStatus?(status: EngagementStatus): Promise<void>;
};

/**
 * Pure: per platform { source, canReply, live, killed, lastSentAt, lastHeldReason, lastError } for the web.
 * Booleans, timestamps and plain-word reasons only: no tokens, ids or env values.
 */
export function buildEngagementStatus(
  sources: Map<EngagementPlatform, CommentSource>,
  facts: ReplyStatusFacts,
  run: { live: boolean; killed: boolean },
  tick: Pick<SendTickResult, "held"> | null,
  now: Date,
): EngagementStatus {
  const platforms: EngagementStatus["platforms"] = {};
  for (const p of ENGAGEMENT_PLATFORMS) {
    const src = sources.get(p);
    const f = facts[p];
    const heldNow = tick?.held.filter((h) => h.platform === p && h.origin === "manual").at(-1)?.reason ?? null;
    const canReply = typeof src?.reply === "function";
    platforms[p] = {
      source: !!src && src.placeholder !== true,
      canReply,
      live: run.live,
      killed: run.killed,
      lastSentAt: f?.lastSentAt ?? null,
      lastHeldReason: heldNow ?? f?.lastHeldReason ?? null,
      lastError: f?.lastError ?? null,
      waiting: f?.waiting ?? 0,
      replyUnavailableReason: canReply ? null : (src?.replyUnavailableReason ?? null),
    };
  }
  return { updatedAt: now.toISOString(), platforms };
}

/** The row is already in `alerts` (store.recordAlert); this just puts it in the worker log. */
export const consoleEngagementAlertSink: EngagementAlertSink = {
  async send(alert) {
    console.log(`[alert] ${alert.kind} ${alert.platform}${alert.actionId ? ` action ${alert.actionId}` : ""}: ${alert.message}`);
  },
};

export async function runEngagementSendWith(store: SendStore, sources: Map<EngagementPlatform, CommentSource>, cfg: EngagementSendConfig): Promise<SendTickResult> {
  const settings = await store.loadSettings();
  const dryRun = cfg.dryRun || !cfg.live;
  const killEnv = cfg.killEnv ?? killEnvFromEnv();
  const log = cfg.log ?? console.log;
  const result = await runSendTick(store, sources, {
    settings,
    dryRun,
    killEnv,
    alerts: consoleEngagementAlertSink,
    log,
    ...(cfg.now ? { now: cfg.now } : {}),
  });
  // The web shows the true reply state from this (Inbox approve message, Platforms "Replies" row).
  if (store.replyStatusFacts && store.saveEngagementStatus) {
    try {
      const status = buildEngagementStatus(sources, await store.replyStatusFacts(), { live: !dryRun, killed: settings.killed || killEnv }, result, cfg.now?.() ?? new Date());
      await store.saveEngagementStatus(status);
    } catch (err) {
      log(`[engage] engagement_status not written: ${(err as Error).message}`);
    }
  }
  return result;
}

export async function runEngagementSendOnce(pool: OutboxPool, sources: Map<EngagementPlatform, CommentSource>, cfg: EngagementSendConfig): Promise<SendTickResult> {
  return runEngagementSendWith(new PgEngagementStore(pool), sources, cfg);
}
