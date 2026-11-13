import type { CommentSource, EngagementPlatform } from "@autopilot/engagement";
import type { FetchLike } from "../http.js";
import { createInstagramCommentSource } from "./instagram.js";
import { createTikTokCommentSource } from "./tiktok.js";
import { createYouTubeCommentSource } from "./youtube.js";

export { createInstagramCommentSource, commentCursorSince, type InstagramCommentsConfig, type InstagramCommentsCursor } from "./instagram.js";
export { createYouTubeCommentSource, type YouTubeCommentsConfig, type YouTubeCommentSource } from "./youtube.js";
export { createTikTokCommentSource } from "./tiktok.js";
export { createInstagramDmSource, type InstagramDmConfig } from "./dm-instagram.js";

export interface CommentCredentials {
  instagram?: { accessToken: string; igUserId: string; graphVersion?: string };
  youtube?: { clientId: string; clientSecret: string; refreshToken: string; channelId: string; canReply?: boolean; canModerate?: boolean };
  /** true = register the TikTok stub (polls return nothing; replies are manual on the free Zernio plan). */
  tiktok?: boolean;
  fetch?: FetchLike;
}

/** Builds the comment sources whose credentials exist. */
export function buildCommentSources(creds: CommentCredentials): Map<EngagementPlatform, CommentSource> {
  const out = new Map<EngagementPlatform, CommentSource>();
  if (creds.instagram) out.set("instagram", createInstagramCommentSource({ ...creds.instagram, fetch: creds.fetch }));
  if (creds.youtube) out.set("youtube", createYouTubeCommentSource({ ...creds.youtube, fetch: creds.fetch }));
  if (creds.tiktok) out.set("tiktok", createTikTokCommentSource());
  return out;
}

/** Reads comment credentials from env vars (names match .env.example). Never logs values. */
export function commentCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): CommentCredentials {
  return {
    instagram: env.META_ACCESS_TOKEN && env.IG_USER_ID ? { accessToken: env.META_ACCESS_TOKEN, igUserId: env.IG_USER_ID, ...(env.META_GRAPH_VERSION ? { graphVersion: env.META_GRAPH_VERSION } : {}) } : undefined,
    youtube:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.YT_REFRESH_TOKEN && env.YT_CHANNEL_ID
        ? {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            refreshToken: env.YT_REFRESH_TOKEN,
            channelId: env.YT_CHANNEL_ID,
            canReply: env.YT_COMMENT_REPLIES === "1", // needs the youtube.force-ssl scope
            canModerate: false,
          }
        : undefined,
    tiktok: true,
  };
}
