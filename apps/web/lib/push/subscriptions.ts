// Server only: Web Push subscriptions (migration 0008). One row per installed PWA, upserted on the
// endpoint. Endpoints and keys are capability URLs/secrets: never logged, never sent back to the page.
import type { Pool } from "pg";

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export class InvalidSubscription extends Error {
  override name = "InvalidSubscription";
}

export const ENDPOINT_MAX = 1024;
/** A P-256 public key is 65 bytes (87 base64url chars); auth is 16 bytes (22). Caps leave a little room. */
export const P256DH_MAX = 100;
export const AUTH_MAX = 44;
export const LABEL_MAX = 60;
/** Settings key the worker's alert-push job reads for "Send test notification" (alert-push-core.ts). */
export const ALERT_PUSH_TEST_SETTING = "alert_push_test";
/** One test per this many seconds. */
export const TEST_COOLDOWN_S = 60;

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

function key(x: unknown, name: string, min: number, max: number): string {
  if (typeof x !== "string" || x.length < min || x.length > max || !B64URL.test(x)) throw new InvalidSubscription(`bad ${name}`);
  return x;
}

/** The browser's PushSubscription.toJSON(), checked: https endpoint (no credentials), base64url keys, length caps. */
export function validateSubscription(x: unknown): PushSubscriptionInput {
  if (!x || typeof x !== "object") throw new InvalidSubscription("not an object");
  const o = x as { endpoint?: unknown; keys?: unknown };
  if (typeof o.endpoint !== "string" || o.endpoint.length > ENDPOINT_MAX) throw new InvalidSubscription("bad endpoint");
  let u: URL;
  try {
    u = new URL(o.endpoint);
  } catch {
    throw new InvalidSubscription("bad endpoint");
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) throw new InvalidSubscription("bad endpoint");
  const keys = o.keys as { p256dh?: unknown; auth?: unknown } | undefined;
  if (!keys || typeof keys !== "object") throw new InvalidSubscription("missing keys");
  return { endpoint: u.toString(), keys: { p256dh: key(keys.p256dh, "p256dh", 40, P256DH_MAX), auth: key(keys.auth, "auth", 16, AUTH_MAX) } };
}

export function cleanLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, LABEL_MAX);
  return s || null;
}

/** Upsert on endpoint; re-subscribing clears revoked_at and takes the new keys + session. */
export async function saveSubscription(pool: Pool, s: PushSubscriptionInput, sessionId: string, label?: string | null): Promise<void> {
  await pool.query(
    `insert into push_subscriptions (endpoint, p256dh, auth, session_id, label) values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, session_id = excluded.session_id,
       label = coalesce(excluded.label, push_subscriptions.label), revoked_at = null`,
    [s.endpoint, s.keys.p256dh, s.keys.auth, sessionId, cleanLabel(label)],
  );
}

/** Revoked by timestamp, never removed. */
export async function revokeSubscription(pool: Pool, endpoint: string, now: Date = new Date()): Promise<void> {
  await pool.query("update push_subscriptions set revoked_at = $2 where endpoint = $1 and revoked_at is null", [endpoint, now]);
}

export async function countActiveSubscriptions(pool: Pool): Promise<number> {
  const { rows } = await pool.query("select count(*)::int as n from push_subscriptions where revoked_at is null");
  return (rows[0]?.n as number | undefined) ?? 0;
}

/**
 * Asks the worker to send one test notification (it polls every minute). Refused within the cooldown.
 * Returns false when refused.
 */
export async function requestTestPush(pool: Pool, now: Date = new Date()): Promise<boolean> {
  const { rows } = await pool.query(
    `insert into settings (key, value, updated_at) values ($1, jsonb_build_object('requested_at', $2::text), now())
     on conflict (key) do update set value = excluded.value, updated_at = now()
       where coalesce((settings.value->>'requested_at')::timestamptz, '-infinity') < $3::timestamptz
     returning key`,
    [ALERT_PUSH_TEST_SETTING, now.toISOString(), new Date(now.getTime() - TEST_COOLDOWN_S * 1000)],
  );
  return rows.length === 1;
}
