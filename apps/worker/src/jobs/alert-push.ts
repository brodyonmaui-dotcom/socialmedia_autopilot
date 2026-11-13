import webpush from "web-push";
import { getSetting } from "@autopilot/db";
import { QUEUES } from "../queue.js";
import {
  ALERT_PUSH_CRON,
  ALERT_PUSH_SETTING,
  VAPID_NOT_SET_LINE,
  alertPushConfigFromEnv,
  runAlertPushOnce,
  runPushTestOnce,
  type PushSender,
} from "./alert-push-core.js";
import { PgAlertPushStore } from "./alert-push-store.js";
import type { OutboxPool } from "./outbox.js";
import type { BossLike } from "./register-engagement.js";

export * from "./alert-push-core.js";

/** Socket timeout per push request; a hung push service must not hold the minute tick. */
export const PUSH_SEND_TIMEOUT_MS = 10_000;

/**
 * Wraps `web-push` (VAPID + aes128gcm). A non-2xx answer comes back as its status (the core decides:
 * 404/410 revoke, else failed); network errors are thrown and counted by the core. The library's
 * error text can include the endpoint, so nothing here logs it.
 */
export function createWebPushSender(env: NodeJS.ProcessEnv): PushSender {
  const vapidDetails = {
    subject: env.VAPID_SUBJECT ?? "",
    publicKey: env.VAPID_PUBLIC_KEY ?? "",
    privateKey: env.VAPID_PRIVATE_KEY ?? "",
  };
  return {
    async send(sub, payload, opts) {
      try {
        const r = await webpush.sendNotification(sub, payload, { TTL: opts.ttlSeconds, urgency: opts.urgency, vapidDetails, timeout: PUSH_SEND_TIMEOUT_MS });
        return { status: r.statusCode };
      } catch (err) {
        if (err instanceof webpush.WebPushError) return { status: err.statusCode };
        throw new Error("push send failed"); // drop the original message (may carry the endpoint)
      }
    },
  };
}

/**
 * Every minute: the pending test request, then new pushable alerts. Runs in dry-run too (approved:
 * private to the creator). Without the three VAPID names the job isn't registered at all: one log line.
 * The alert_push setting is re-read each tick, so a kinds change needs no restart.
 */
export async function registerAlertPushJob(boss: BossLike, pool: OutboxPool, env: NodeJS.ProcessEnv, log: (l: string) => void = console.log): Promise<void> {
  if (!alertPushConfigFromEnv(env).enabled) {
    log(VAPID_NOT_SET_LINE);
    return;
  }
  const store = new PgAlertPushStore(pool);
  const sender = createWebPushSender(env);
  await boss.createQueue(QUEUES.alertPush);
  await boss.work(QUEUES.alertPush, async () => {
    const now = new Date();
    const setting = await getSetting<unknown>(pool as Parameters<typeof getSetting>[0], ALERT_PUSH_SETTING);
    const cfg = alertPushConfigFromEnv(env, setting);
    await runPushTestOnce(store, sender, cfg, now, log);
    await runAlertPushOnce(store, sender, cfg, now, log);
  });
  await boss.schedule(QUEUES.alertPush, ALERT_PUSH_CRON);
}
