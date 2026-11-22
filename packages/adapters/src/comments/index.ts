import { sanitizeError } from "@autopilot/core";
import type { CommentSource, EngagementPlatform } from "@autopilot/engagement";
import type { FetchLike } from "../http.js";
import { createInstagramCommentSource } from "./instagram.js";
import { createTikTokCommentSource } from "./tiktok.js";
import { createYouTubeCommentSource, resolveYouTubeChannelId } from "./youtube.js";

export { createInstagramCommentSource, commentCursorSince, type InstagramCommentsConfig, type InstagramCommentsCursor } from "./instagram.js";
export { createYouTubeCommentSource, resolveYouTubeChannelId, clearYouTubeChannelIdCache, type YouTubeCommentsConfig, type YouTubeCommentSource } from "./youtube.js";
export { createTikTokCommentSource, tiktokCommentKey, parseTikTokCommentKey, type TikTokCommentsConfig } from "./tiktok.js";
export { createInstagramDmSource, type InstagramDmConfig } from "./dm-instagram.js";

export interface CommentCredentials {
  instagram?: { accessToken: string; igUserId: string; graphVersion?: string };
  /** channelId missing (no YT_CHANNEL_ID) → prepareCommentSources resolves it with channels.list?mine=true. */
  youtube?: { clientId: string; clientSecret: string; refreshToken: string; channelId?: string; canReply?: boolean; canModerate?: boolean };
  /** Zernio credentials → TikTok comments through Zernio; true → the stub (polls return nothing). */
  tiktok?: { apiKey: string; accountId: string; baseUrl?: string } | true;
  fetch?: FetchLike;
  log?: (line: string) => void;
}

/** Builds the comment sources whose credentials exist. YouTube without a channel id is skipped (see prepareCommentSources). */
export function buildCommentSources(creds: CommentCredentials): Map<EngagementPlatform, CommentSource> {
  const out = new Map<EngagementPlatform, CommentSource>();
  if (creds.instagram) out.set("instagram", createInstagramCommentSource({ ...creds.instagram, fetch: creds.fetch }));
  const yt = creds.youtube;
  if (yt?.channelId) out.set("youtube", createYouTubeCommentSource({ ...yt, channelId: yt.channelId, fetch: creds.fetch }));
  if (creds.tiktok === true) out.set("tiktok", createTikTokCommentSource());
  else if (creds.tiktok) out.set("tiktok", createTikTokCommentSource({ ...creds.tiktok, ...(creds.fetch ? { fetch: creds.fetch } : {}), ...(creds.log ? { log: creds.log } : {}) }));
  return out;
}

/**
 * Like buildCommentSources, but first fills in a missing YouTube channel id from `channels.list?part=id&mine=true`
 * (1 quota unit, existing OAuth refresh, cached for the process). If that fails: one log line, YouTube skipped.
 */
export async function prepareCommentSources(creds: CommentCredentials, log: (line: string) => void = creds.log ?? console.log): Promise<Map<EngagementPlatform, CommentSource>> {
  const yt = creds.youtube;
  if (yt && !yt.channelId) {
    try {
      const channelId = await resolveYouTubeChannelId({ clientId: yt.clientId, clientSecret: yt.clientSecret, refreshToken: yt.refreshToken, ...(creds.fetch ? { fetch: creds.fetch } : {}) });
      log("[engage] youtube comments: channel id resolved from the OAuth account (set YT_CHANNEL_ID to skip this lookup)");
      return buildCommentSources({ ...creds, youtube: { ...yt, channelId } });
    } catch (err) {
      log(`[engage] youtube comments skipped: channel lookup failed (${sanitizeError(err)})`);
      const { youtube: _skip, ...rest } = creds;
      return buildCommentSources(rest);
    }
  }
  return buildCommentSources(creds);
}

/** Reads comment credentials from env vars (names match .env.example). Never logs values. */
export function commentCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): CommentCredentials {
  return {
    instagram: env.META_ACCESS_TOKEN && env.IG_USER_ID ? { accessToken: env.META_ACCESS_TOKEN, igUserId: env.IG_USER_ID, ...(env.META_GRAPH_VERSION ? { graphVersion: env.META_GRAPH_VERSION } : {}) } : undefined,
    youtube:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.YT_REFRESH_TOKEN
        ? {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            refreshToken: env.YT_REFRESH_TOKEN,
            ...(env.YT_CHANNEL_ID?.trim() ? { channelId: env.YT_CHANNEL_ID.trim() } : {}),
            canReply: env.YT_COMMENT_REPLIES === "1", // needs the youtube.force-ssl scope
            canModerate: false,
          }
        : undefined,
    // Same Zernio credentials as posting (registry.ts); comments need a Business-app TikTok connection.
    tiktok: env.ZERNIO_API_KEY && env.ZERNIO_TIKTOK_ACCOUNT_ID ? { apiKey: env.ZERNIO_API_KEY, accountId: env.ZERNIO_TIKTOK_ACCOUNT_ID } : true,
  };
}
