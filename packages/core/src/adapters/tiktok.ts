import type { OutboxPost, PlatformAdapter, PublishResult } from "../types.js";

export interface TikTokAdapterConfig {
  apiKey: string;
  accountId: string;
}

interface ZernioPostResponse {
  post?: { platforms?: Array<ZernioPlatformResult> };
  platforms?: Array<ZernioPlatformResult>;
  error?: { message?: string };
}
interface ZernioPlatformResult {
  status?: string;
  platformPostId?: string;
  platformPostUrl?: string;
  reason?: string;
}

/**
 * Direct public post via Zernio's Business-API lane. scheduledFor + timezone are top-level
 * fields on the post (confirmed against docs.zernio.com/products/scheduler.mdx) — Zernio holds
 * the TikTok clock from there, same as CLAUDE.md's platform-routes table says.
 */
export function createTikTokAdapter(cfg: TikTokAdapterConfig): PlatformAdapter {
  return {
    platform: "tiktok",
    async publish(post: OutboxPost): Promise<PublishResult> {
      const body = {
        content: post.caption,
        mediaItems: [{ type: "video", url: post.mediaUrl }],
        scheduledFor: post.scheduledFor,
        timezone: "UTC", // we always pass a Z-suffixed ISO timestamp, so this only affects display
        platforms: [
          {
            platform: "tiktok",
            accountId: cfg.accountId,
            platformSpecificData: {
              tiktokSettings: {
                privacy_level: "PUBLIC_TO_EVERYONE",
                allow_comment: true,
                allow_duet: false,
                allow_stitch: false,
                content_preview_confirmed: true,
                express_consent_given: true,
              },
            },
          },
        ],
      };

      const res = await fetch("https://zernio.com/api/v1/posts", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": post.idempotencyKey },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ZernioPostResponse;
      if (res.status >= 300) throw new Error(`tiktok (zernio) post failed: HTTP ${res.status} ${data.error?.message ?? JSON.stringify(data)}`);

      const plat = data.post?.platforms?.[0] ?? data.platforms?.[0];
      if (!plat || plat.status === "failed") throw new Error(`tiktok (zernio) platform rejected: ${plat?.reason ?? "unknown reason"}`);

      return { platformPostId: plat.platformPostId ?? "", platformPostUrl: plat.platformPostUrl };
    },
  };
}
