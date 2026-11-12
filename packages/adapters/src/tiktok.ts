import { NonRetryableError, type OutboxPost, type PlatformAdapter, type PublishOptions, type PublishResult } from "@autopilot/core";
import { assertNoLocationFields, countHashtags, getJson, PlatformRequestError, type FetchLike } from "./http.js";

export interface TikTokAdapterConfig {
  apiKey: string;
  accountId: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Voice guide: TikTok 3–5 hashtags. Hard stop above this. */
  maxHashtags?: number;
}

interface ZernioPlatformResult {
  status?: string;
  platformPostId?: string;
  platformPostUrl?: string;
  reason?: string;
  error?: string;
}
export interface ZernioPostResponse {
  post?: { id?: string; _id?: string; status?: string; platforms?: ZernioPlatformResult[] };
  platforms?: ZernioPlatformResult[];
  error?: { message?: string; code?: string } | string;
  message?: string;
}

/** Zernio errors that no retry fixes (research.md 2026-11-11 entry). */
const PERMANENT = [/duplicate content/i, /spam_risk/i, /too many posts in the last 24 hours/i, /drafts? .*pending/i];

/**
 * TikTok via Zernio's Business-API lane (middleman route). scheduledFor + timezone are top-level post
 * fields (docs.zernio.com/products/scheduler.mdx): Zernio holds the TikTok clock. Idempotency-Key
 * (24 h window) makes a resend return the original post, which is why there's no separate lookup
 * (research.md documents no "find post by key" endpoint — see the night log).
 * Sound-dependent posts go to the Creator Inbox as draft:true (max 5 pending/24 h).
 */
export function createTikTokAdapter(cfg: TikTokAdapterConfig): PlatformAdapter {
  const fetchImpl = cfg.fetch ?? ((url, init) => fetch(url, init));
  const base = cfg.baseUrl ?? "https://zernio.com/api/v1";
  const maxHashtags = cfg.maxHashtags ?? 5;
  return {
    platform: "tiktok",
    async publish(post: OutboxPost, opts: PublishOptions = {}): Promise<PublishResult> {
      if (countHashtags(post.caption) > maxHashtags) throw new NonRetryableError(`tiktok: caption has more than ${maxHashtags} hashtags`);
      if (post.caption.length > 2200) throw new NonRetryableError("tiktok: caption longer than 2,200 characters");
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
                ...(post.tiktokDraft ? { draft: true } : {}),
              },
            },
          },
        ],
      };
      assertNoLocationFields("tiktok", body);

      const r = await getJson<ZernioPostResponse>(
        fetchImpl,
        `${base}/posts`,
        { method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": post.idempotencyKey }, body: JSON.stringify(body) },
        opts.signal,
      );
      const errMsg = typeof r.body.error === "string" ? r.body.error : (r.body.error?.message ?? r.body.message);
      if (r.status >= 300) {
        const msg = `tiktok (zernio) post failed: HTTP ${r.status} ${errMsg ?? JSON.stringify(r.body)}`;
        if (PERMANENT.some((p) => p.test(msg))) throw new NonRetryableError(msg);
        throw new PlatformRequestError("tiktok", r.status, r.body, msg);
      }

      const plat = r.body.post?.platforms?.[0] ?? r.body.platforms?.[0];
      if (!plat || plat.status === "failed") {
        const msg = `tiktok (zernio) platform rejected: ${plat?.reason ?? plat?.error ?? "unknown reason"}`;
        if (PERMANENT.some((p) => p.test(msg))) throw new NonRetryableError(msg);
        throw new PlatformRequestError("tiktok", r.status, r.body, msg);
      }
      // M1 day 1: platformPostUrl is empty right after posting; the Zernio post id is the stable handle.
      const flags = post.tiktokDraft ? ["sent to the TikTok Creator Inbox as a draft: finish it in the app (add the sound)"] : [];
      return { platformPostId: plat.platformPostId || r.body.post?.id || r.body.post?._id || "", platformPostUrl: plat.platformPostUrl || undefined, flags };
    },
  };
}
