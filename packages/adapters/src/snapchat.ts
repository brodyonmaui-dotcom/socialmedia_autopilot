import { NonRetryableError, type OutboxPost, type PlatformAdapter, type PublishResult } from "@autopilot/core";

/**
 * Snapchat is assisted (decisions.md §3): the dashboard hands the file + caption to the iOS share
 * sheet (Web Share API) and the creator taps through to Spotlight. There is no API call, so the
 * adapter's publish() refuses, permanently: the outbox must never "fire" Snapchat. The handoff
 * payload is what the phone page shows.
 */
export interface SnapchatHandoff {
  postId: string;
  mediaUrl: string;
  /** One-liner only, no hashtags beyond 1–2 topic tags (voice.md). */
  caption: string;
  checklist: string[];
}

export const SNAPCHAT_CHECKLIST = [
  "Share → Snapchat → Spotlight (not Story).",
  "Keep Snap Map / location OFF on the posting screen.",
  "If the share sheet is blank, open Snapchat once, then retry.",
  "One Spotlight a day; skipped days just roll forward.",
];

/** Trims a caption to the Spotlight shape: first line, at most 2 hashtags. */
export function snapchatCaption(caption: string): string {
  const first = caption.split("\n").find((l) => l.trim().length > 0) ?? "";
  const tags = caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.map((t) => t.trim()) ?? [];
  const body = first.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "").trim();
  return [body, ...tags.slice(0, 2)].filter(Boolean).join(" ").trim();
}

export function buildSnapchatHandoff(post: OutboxPost): SnapchatHandoff {
  return { postId: post.id, mediaUrl: post.mediaUrl, caption: snapchatCaption(post.caption), checklist: [...SNAPCHAT_CHECKLIST] };
}

export function createSnapchatAdapter(): PlatformAdapter {
  return {
    platform: "snapchat",
    async publish(post: OutboxPost): Promise<PublishResult> {
      throw new NonRetryableError(`snapchat is assisted: post ${post.id} goes through the share sheet, never the outbox`);
    },
  };
}
