import type { Platform, PostStatus } from "@autopilot/core";

export type MediaStatus = "ingested" | "qa_pass" | "qa_fail" | "ready" | "used";

export interface MediaRow {
  id: string;
  content_hash: string;
  source_path: string | null;
  r2_key: string | null;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  pillar: string | null;
  status: MediaStatus;
  qa: unknown;
  captured_at: string | null;
  created_at: string;
  updated_at: string;
}

export type BatchStatus = "draft" | "approved";

export interface BatchRow {
  id: string;
  week_start: string;
  status: BatchStatus;
  /** Set when the batch was approved (migration 0006). */
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BatchItemRow {
  id: string;
  batch_id: string;
  media_id: string;
  platform: Platform;
  caption: string;
  title: string | null;
  trial: unknown;
  scheduled_for: string | null;
  idempotency_key: string;
  /** PostStatus plus 'rejected' (a status, never a delete; migration 0006 CHECK). */
  status: BatchItemStatus;
  attempts: number;
  /** Set while status = 'queued' (waiting out a retry backoff); migration 0005. */
  next_attempt_at: string | null;
  last_error: string | null;
  platform_post_id: string | null;
  platform_post_url: string | null;
  /** Approval stamp + the app session that approved (migration 0006). */
  approved_at: string | null;
  approved_session: string | null;
  created_at: string;
  updated_at: string;
}

export type BatchItemStatus = PostStatus | "rejected";

/** Every batch_items.status the code writes; mirrors the CHECK in migration 0006. */
export const BATCH_ITEM_STATUSES: readonly BatchItemStatus[] = [
  "draft", "approved", "queued", "publishing", "published", "failed", "unknown", "rejected",
];

export type BatchItemEventKind =
  | "approve" | "approve-all" | "approve-cli" | "reject" | "unapprove" | "edit" | "add"
  /** F11: failed|unknown → draft after the creator checked the platform ("it's not there"). */
  | "reset-checked"
  /** F11: failed|unknown → published with the URL the creator found ("it's there"). */
  | "record-published";

/** Audit row for a status change made from the app or a CLI (migration 0006). */
export interface BatchItemEventRow {
  id: string;
  batch_item_id: string;
  kind: BatchItemEventKind;
  from_status: BatchItemStatus | null;
  to_status: BatchItemStatus | null;
  detail: unknown;
  session_id: string | null;
  at: string;
}

import type { AlertKind, AlertSource } from "@autopilot/core";
export type { AlertKind, AlertSource };
export { ALERT_KINDS, PUSH_KINDS_DEFAULT, isAlertKind } from "@autopilot/core";

/** Alerts a human must look at (migration 0005; push + audit columns from 0008). */
export interface AlertRow {
  id: string;
  kind: AlertKind;
  batch_item_id: string | null;
  /** Free text in the DB; a platform or a service ("web", "meta", "zernio", "all"). */
  platform: AlertSource;
  message: string;
  created_at: string;
  /** Acknowledge is a timestamp, never a delete. */
  acknowledged_at: string | null;
  /** The app session that acknowledged it (0008). */
  acknowledged_session: string | null;
  /** Set when the alert-push job claimed it (at-most-once); 0008 backfilled existing rows. */
  pushed_at: string | null;
}

/** One Web Push subscription per installed PWA (migration 0008). Endpoint and keys are never logged. */
export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  session_id: string | null;
  label: string | null;
  created_at: string;
  last_success_at: string | null;
  revoked_at: string | null;
}
