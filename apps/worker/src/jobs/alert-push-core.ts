// Fable to review: push gating + dedupe
//
// F8 alert push, the pure part: which alerts may push, the payload, and the claim-then-send loop.
// All I/O is injected (AlertPushStore, PushSender), so every rule here is unit-tested.
//
// Rules (docs/design/F8.md "Rules for runAlertPushOnce"):
//  - Gate: kind in the effective list (setting alert_push.kinds, else PUSH_KINDS_DEFAULT; metrics-health
//    is never pushed by default), pushed_at is null, acknowledged_at is null, created_at within maxAgeH.
//  - Claim before send (at-most-once): the store's claim is one conditional UPDATE … set pushed_at
//    where pushed_at is null, so only the claimer sends. A send error after the claim never un-claims;
//    it is counted and logged (counts only). The alert is still on the /alerts page.
//  - Bundling: every claimed alert goes into ONE notification per active subscription.
//  - 404/410 → that subscription is revoked (revoked_at; never deleted). Revoked subscriptions are skipped.
//  - Push also runs in dry-run: it is a private notification to the creator, not a public action.
//  - Payload: {count, kinds, sources, url:"/app/alerts"} only. Never message text, ids, tokens, endpoints.
//    One exception (run 4): a push of exactly one 'reply-ready' alert carries its message as `body` (written
//    by the triage job, already privacy-linted: places become "A comment needs you") and a deep link to
//    /app/inbox/item/<commentId>. Only reply-ready pushes → url /app/inbox. Mixed pushes stay as before.
//    Same for a push made only of 'auto-scheduled' alerts ("Scheduled: <title> at <time>", written by the
//    editor auto-approve runner): one → that message as body; several → "N posts scheduled · <first message>";
//    url /app/calendar (no per-item calendar route exists), so a tap opens where it can be pulled back.
//  - Logs: counts only. Never an endpoint, key, message or error text (error text can carry the endpoint).
import { ALERT_KINDS, PUSH_KINDS_DEFAULT, isAlertKind, type AlertKind, type AlertSource } from "@autopilot/core";
import type { AlertRow, PushSubscriptionRow } from "@autopilot/db";

export const VAPID_NOT_SET_LINE = "alert-push: VAPID not set";
export const ALERT_PUSH_CRON = "* * * * *"; // every minute
export const ALERT_PUSH_TTL_S = 3600; // a stale "act soon" page is noise: the push service drops it after 1 h
export const ALERT_PUSH_MAX_AGE_H = 24;
export const ALERT_PUSH_CLAIM_LIMIT = 50;
export const ALERT_PUSH_URL = "/app/alerts" as const;

/** Settings key for the optional override: {"kinds": [...]} (no row by default). */
export const ALERT_PUSH_SETTING = "alert_push";
/** Settings key the web "Send test notification" action writes: {"requested_at": iso}. */
export const ALERT_PUSH_TEST_SETTING = "alert_push_test";

export type ClaimedAlert = Pick<AlertRow, "id" | "kind" | "platform"> & { message?: string; comment_id?: string | null };
export const REPLY_READY_INBOX_URL = "/app/inbox" as const;
export const AUTO_SCHEDULED_URL = "/app/calendar" as const;
/** Same cap as the service worker applies to a payload body. */
export const PUSH_BODY_MAX = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Urgency = "high" | "normal";

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushSender {
  send(sub: PushTarget, payload: string, opts: { ttlSeconds: number; urgency: Urgency }): Promise<{ status: number }>;
}

export interface PushPayload {
  count: number;
  kinds: AlertKind[];
  sources: AlertSource[];
  url: typeof ALERT_PUSH_URL | typeof REPLY_READY_INBOX_URL | typeof AUTO_SCHEDULED_URL | `/app/inbox/item/${string}`;
  /** reply-ready / auto-scheduled only (see header). */
  body?: string;
  test?: true;
}

export interface AlertPushStore {
  /** One conditional UPDATE … set pushed_at = now where pushed_at is null and acknowledged_at is null and created_at >= since and kind = any(kinds) … returning. */
  claimUnpushed(kinds: readonly AlertKind[], since: Date, now: Date, limit: number): Promise<ClaimedAlert[]>;
  /** revoked_at is null only. */
  activeSubscriptions(): Promise<PushSubscriptionRow[]>;
  markSuccess(id: string, now: Date): Promise<void>;
  /** On 404/410 from the push service. Sets revoked_at; never deletes. */
  revoke(id: string, now: Date): Promise<void>;
  /** True once per pending "Send test notification" request (claimed atomically). */
  claimTestRequest(now: Date): Promise<boolean>;
}

export interface AlertPushConfig {
  kinds: readonly AlertKind[];
  enabled: boolean;
  maxAgeH: number;
}

export interface AlertPushResult {
  claimed: number;
  sent: number;
  revoked: number;
  failed: number;
}

const ZERO: AlertPushResult = { claimed: 0, sent: 0, revoked: 0, failed: 0 };

const SOURCES: readonly AlertSource[] = ["instagram", "youtube", "tiktok", "snapchat", "web", "meta", "zernio", "all"];
const HIGH: ReadonlySet<AlertKind> = new Set(["engagement-kill", "unknown-outcome"]);

/** settings.alert_push → kinds. Missing / malformed → PUSH_KINDS_DEFAULT; an explicit list keeps only known kinds ([] = push nothing). */
export function effectivePushKinds(setting: unknown): readonly AlertKind[] {
  const kinds = (setting as { kinds?: unknown } | null | undefined)?.kinds;
  if (!Array.isArray(kinds)) return PUSH_KINDS_DEFAULT;
  return ALERT_KINDS.filter((k) => kinds.includes(k)).sort((a, b) => kinds.indexOf(a) - kinds.indexOf(b));
}

/** Enabled only when all three VAPID names are set (values never logged). */
export function alertPushConfigFromEnv(env: NodeJS.ProcessEnv, setting?: unknown): AlertPushConfig {
  const set = (k: string) => typeof env[k] === "string" && env[k]!.trim() !== "";
  return {
    kinds: effectivePushKinds(setting),
    enabled: set("VAPID_PUBLIC_KEY") && set("VAPID_PRIVATE_KEY") && set("VAPID_SUBJECT"),
    maxAgeH: ALERT_PUSH_MAX_AGE_H,
  };
}

const sinceFor = (cfg: AlertPushConfig, now: Date) => new Date(now.getTime() - cfg.maxAgeH * 3_600_000);

/** The gate, as a predicate (the store's claim SQL is the same condition). */
export function isPushable(
  a: { kind: string; created_at: Date | string; pushed_at: Date | string | null; acknowledged_at: Date | string | null },
  cfg: AlertPushConfig,
  now: Date,
): boolean {
  if (a.pushed_at != null || a.acknowledged_at != null) return false;
  if (!isAlertKind(a.kind) || !cfg.kinds.includes(a.kind)) return false;
  return new Date(a.created_at).getTime() >= sinceFor(cfg, now).getTime();
}

/** Pure; built from kind + source only (message text only for the reply-ready / auto-scheduled cases in the header). */
export function buildPayload(alerts: ReadonlyArray<Pick<AlertRow, "kind" | "platform"> & { message?: string; comment_id?: string | null }>): PushPayload {
  const kinds: AlertKind[] = [];
  const sources: AlertSource[] = [];
  for (const a of alerts) {
    if (isAlertKind(a.kind) && !kinds.includes(a.kind)) kinds.push(a.kind);
    if ((SOURCES as readonly string[]).includes(a.platform) && !sources.includes(a.platform)) sources.push(a.platform);
  }
  if (alerts.length > 0 && alerts.every((a) => a.kind === "reply-ready")) {
    const one = alerts.length === 1 ? alerts[0]! : null;
    const id = one?.comment_id && UUID.test(one.comment_id) ? one.comment_id : null;
    const body = one && typeof one.message === "string" ? one.message.slice(0, PUSH_BODY_MAX) : undefined;
    return { count: alerts.length, kinds, sources, url: id ? `/app/inbox/item/${id}` : REPLY_READY_INBOX_URL, ...(body ? { body } : {}) };
  }
  if (alerts.length > 0 && alerts.every((a) => a.kind === "auto-scheduled")) {
    const first = alerts.map((a) => (typeof a.message === "string" ? a.message.trim() : "")).find((m) => m !== "") ?? "";
    const text = alerts.length === 1 ? first : [`${alerts.length} posts scheduled`, first].filter(Boolean).join(" · ");
    const body = text.slice(0, PUSH_BODY_MAX);
    return { count: alerts.length, kinds, sources, url: AUTO_SCHEDULED_URL, ...(body ? { body } : {}) };
  }
  return { count: alerts.length, kinds, sources, url: ALERT_PUSH_URL };
}

export function urgencyFor(kinds: readonly AlertKind[]): Urgency {
  return kinds.some((k) => HIGH.has(k)) ? "high" : "normal";
}

export function classifyPushStatus(status: number): "ok" | "revoke" | "failed" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 410) return "revoke";
  return "failed";
}

/** One payload to every active subscription. Errors are counted, never logged with their text. */
async function fanOut(store: AlertPushStore, sender: PushSender, subs: PushSubscriptionRow[], payload: PushPayload, now: Date): Promise<Omit<AlertPushResult, "claimed">> {
  const body = JSON.stringify(payload);
  const opts = { ttlSeconds: ALERT_PUSH_TTL_S, urgency: urgencyFor(payload.kinds) };
  const out = { sent: 0, revoked: 0, failed: 0 };
  for (const s of subs) {
    if (s.revoked_at) continue;
    let cls: "ok" | "revoke" | "failed";
    try {
      cls = classifyPushStatus((await sender.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, opts)).status);
    } catch {
      cls = "failed";
    }
    try {
      if (cls === "ok") {
        await store.markSuccess(s.id, now);
        out.sent++;
      } else if (cls === "revoke") {
        await store.revoke(s.id, now);
        out.revoked++;
      } else out.failed++;
    } catch {
      out.failed++;
    }
  }
  return out;
}

function summary(r: AlertPushResult): string {
  return `[alert-push] claimed ${r.claimed} · sent ${r.sent} · revoked ${r.revoked} · failed ${r.failed}`;
}

/** One tick: claim the pushable alerts, then one bundled notification per active subscription. */
export async function runAlertPushOnce(
  store: AlertPushStore,
  sender: PushSender,
  cfg: AlertPushConfig,
  now: Date = new Date(),
  log: (l: string) => void = console.log,
): Promise<AlertPushResult> {
  if (!cfg.enabled) {
    log(VAPID_NOT_SET_LINE);
    return { ...ZERO };
  }
  if (cfg.kinds.length === 0) return { ...ZERO };
  const subs = (await store.activeSubscriptions()).filter((s) => !s.revoked_at);
  // Nobody to tell yet: leave the alerts unclaimed, so they still push once a phone subscribes (within maxAgeH).
  if (subs.length === 0) return { ...ZERO };
  const claimed = await store.claimUnpushed(cfg.kinds, sinceFor(cfg, now), now, ALERT_PUSH_CLAIM_LIMIT);
  if (claimed.length === 0) return { ...ZERO };
  const r: AlertPushResult = { claimed: claimed.length, ...(await fanOut(store, sender, subs, buildPayload(claimed), now)) };
  if (r.failed > 0) log(`[alert-push] failed n=${r.failed}`);
  log(summary(r));
  return r;
}

/** "Send test notification": a kind-free payload, once per request from the web action. */
export async function runPushTestOnce(
  store: AlertPushStore,
  sender: PushSender,
  cfg: AlertPushConfig,
  now: Date = new Date(),
  log: (l: string) => void = console.log,
): Promise<AlertPushResult> {
  if (!cfg.enabled) return { ...ZERO };
  if (!(await store.claimTestRequest(now))) return { ...ZERO };
  const subs = (await store.activeSubscriptions()).filter((s) => !s.revoked_at);
  const r: AlertPushResult = { claimed: 1, ...(await fanOut(store, sender, subs, { count: 0, kinds: [], sources: [], url: ALERT_PUSH_URL, test: true }, now)) };
  log(`[alert-push] test · sent ${r.sent} · revoked ${r.revoked} · failed ${r.failed}`);
  return r;
}
