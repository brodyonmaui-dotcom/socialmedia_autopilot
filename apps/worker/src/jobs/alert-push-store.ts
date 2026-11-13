import type { AlertKind } from "@autopilot/core";
import type { PushSubscriptionRow } from "@autopilot/db";
import { ALERT_PUSH_TEST_SETTING, type AlertPushStore, type ClaimedAlert } from "./alert-push-core.js";
import type { OutboxPool } from "./outbox.js";

/** A test request older than this is ignored (the creator has long since stopped waiting for it). */
export const TEST_REQUEST_MAX_AGE_MIN = 10;

/**
 * pg side of the alert push. The claim is ONE conditional UPDATE: the inner select skips rows another
 * tick has locked, and the outer `pushed_at is null` re-check means a row is returned to exactly one
 * claimer even under concurrent ticks. Subscriptions are revoked by timestamp, never deleted.
 */
export class PgAlertPushStore implements AlertPushStore {
  constructor(private readonly pool: OutboxPool) {}

  async claimUnpushed(kinds: readonly AlertKind[], since: Date, now: Date, limit: number): Promise<ClaimedAlert[]> {
    if (kinds.length === 0) return [];
    const { rows } = await this.pool.query(
      `update alerts set pushed_at = $3
        where id in (select id from alerts
                      where pushed_at is null and acknowledged_at is null and created_at >= $2 and kind = any($1::text[])
                      order by created_at, id
                      limit $4
                      for update skip locked)
          and pushed_at is null
        returning id, kind, platform`,
      [[...kinds], since, now, limit],
    );
    return rows as ClaimedAlert[];
  }

  async activeSubscriptions(): Promise<PushSubscriptionRow[]> {
    const { rows } = await this.pool.query(
      `select id, endpoint, p256dh, auth, session_id, label, created_at, last_success_at, revoked_at
         from push_subscriptions where revoked_at is null order by created_at, id`,
    );
    return rows as PushSubscriptionRow[];
  }

  async markSuccess(id: string, now: Date): Promise<void> {
    await this.pool.query("update push_subscriptions set last_success_at = $2 where id = $1", [id, now]);
  }

  async revoke(id: string, now: Date): Promise<void> {
    await this.pool.query("update push_subscriptions set revoked_at = $2 where id = $1 and revoked_at is null", [id, now]);
  }

  /** settings.alert_push_test = {requested_at}; handled_at is stamped by whoever claims it first. */
  async claimTestRequest(now: Date): Promise<boolean> {
    const { rows } = await this.pool.query(
      `update settings set value = value || jsonb_build_object('handled_at', $2::text), updated_at = now()
        where key = $1
          and value ? 'requested_at'
          and (value->>'requested_at')::timestamptz > $3::timestamptz
          and (not (value ? 'handled_at') or (value->>'handled_at')::timestamptz < (value->>'requested_at')::timestamptz)
        returning key`,
      [ALERT_PUSH_TEST_SETTING, now.toISOString(), new Date(now.getTime() - TEST_REQUEST_MAX_AGE_MIN * 60_000)],
    );
    return rows.length === 1;
  }
}
