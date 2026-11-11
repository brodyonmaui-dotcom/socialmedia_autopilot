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
  scheduled_for: string;
  idempotency_key: string;
  status: PostStatus;
  attempts: number;
  last_error: string | null;
  platform_post_id: string | null;
  platform_post_url: string | null;
  created_at: string;
  updated_at: string;
}
