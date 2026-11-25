// Reply status the worker writes after every send tick (settings key `engagement_status`) and the web reads
// (Inbox approve message, Platforms "Replies" row). Pure: types, parsing, plain-word readiness. No secrets:
// only booleans, timestamps and reason texts the send tick already stores on rows.

import type { EngagementPlatform } from "./types.js";

export const ENGAGEMENT_STATUS_KEY = "engagement_status";

export interface PlatformReplyStatus {
  /** A real comment source runs for this platform (a no-credentials placeholder counts as false). */
  source: boolean;
  /** The source can post replies. */
  canReply: boolean;
  /** The worker sends for real (DRY_RUN=false and the live start). */
  live: boolean;
  /** Kill switch (setting or ENGAGEMENT_KILL). */
  killed: boolean;
  lastSentAt: string | null;
  /** Newest reason an approved reply is waiting (null when nothing waits). */
  lastHeldReason: string | null;
  /** Newest failed / unknown reply error. */
  lastError: string | null;
  /** Approved replies still waiting to go out. */
  waiting?: number;
  /** Why reply() is missing, in plain words (only when canReply is false). */
  replyUnavailableReason?: string | null;
}

export interface EngagementStatus {
  updatedAt: string;
  platforms: Partial<Record<EngagementPlatform, PlatformReplyStatus>>;
}

const PLATFORMS: readonly EngagementPlatform[] = ["instagram", "youtube", "tiktok"];
export const REPLY_PLATFORM_NAME: Record<EngagementPlatform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok" };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Tolerant parse of the stored setting; anything malformed → null (the worker hasn't reported yet). */
export function parseEngagementStatus(raw: unknown): EngagementStatus | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const ps = typeof r.platforms === "object" && r.platforms !== null ? (r.platforms as Record<string, unknown>) : null;
  if (!ps) return null;
  const platforms: EngagementStatus["platforms"] = {};
  for (const p of PLATFORMS) {
    const v = ps[p];
    if (typeof v !== "object" || v === null) continue;
    const s = v as Record<string, unknown>;
    platforms[p] = {
      source: s.source === true,
      canReply: s.canReply === true,
      live: s.live === true,
      killed: s.killed === true,
      lastSentAt: str(s.lastSentAt),
      lastHeldReason: str(s.lastHeldReason),
      lastError: str(s.lastError),
      ...(typeof s.waiting === "number" ? { waiting: s.waiting } : {}),
      ...(str(s.replyUnavailableReason) ? { replyUnavailableReason: str(s.replyUnavailableReason) } : {}),
    };
  }
  return { updatedAt: str(r.updatedAt) ?? new Date(0).toISOString(), platforms };
}

/** "Ready to send", or what's missing, for one platform. */
export function replyReadiness(platform: EngagementPlatform, s: PlatformReplyStatus | null | undefined): { ready: boolean; text: string } {
  const name = REPLY_PLATFORM_NAME[platform];
  if (!s) return { ready: false, text: "The worker hasn't reported its reply state yet" };
  if (!s.source) return { ready: false, text: s.replyUnavailableReason ?? `${name} isn't connected on the server` };
  if (!s.canReply) return { ready: false, text: s.replyUnavailableReason ?? `${name} replies aren't available on the server` };
  if (!s.live) return { ready: false, text: "Worker is in dry run (it sends only with DRY_RUN=false and the live start)" };
  if (s.killed) return { ready: false, text: "Replies are paused (kill switch is on)" };
  return { ready: true, text: "Ready to send" };
}
