import type { OutboxPost, PlatformAdapter, PublishResult } from "../types.js";

export interface YouTubeAdapterConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

async function refreshAccessToken(cfg: YouTubeAdapterConfig): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string; error?: string };
  if (!body.access_token) throw new Error(`youtube token refresh failed: ${body.error_description ?? body.error}`);
  return body.access_token;
}

/**
 * Uploads private + status.publishAt (YouTube holds the clock — CLAUDE.md platform routes).
 * Streams the R2-hosted file straight into the resumable upload rather than buffering it.
 */
export function createYouTubeAdapter(cfg: YouTubeAdapterConfig): PlatformAdapter {
  return {
    platform: "youtube",
    async publish(post: OutboxPost): Promise<PublishResult> {
      const access = await refreshAccessToken(cfg);
      const auth = { Authorization: `Bearer ${access}` };

      const meta = {
        snippet: { title: post.title ?? post.caption.slice(0, 60), description: post.caption, categoryId: "22" },
        status: { privacyStatus: "private", selfDeclaredMadeForKids: false, publishAt: post.scheduledFor },
      };
      const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json", "X-Upload-Content-Type": "video/*" },
        body: JSON.stringify(meta),
      });
      const location = init.headers.get("location");
      if (!location) throw new Error(`youtube upload init failed: HTTP ${init.status} ${await init.text()}`);

      const source = await fetch(post.mediaUrl);
      if (!source.ok || !source.body) throw new Error(`could not fetch media for upload: HTTP ${source.status}`);
      const contentLength = source.headers.get("content-length");

      const up = await fetch(location, {
        method: "PUT",
        headers: { "Content-Type": "video/*", ...(contentLength ? { "Content-Length": contentLength } : {}) },
        body: source.body,
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      const upBody = (await up.json()) as { id?: string; error?: { message?: string; errors?: Array<{ reason?: string }> } };
      if (up.status !== 200 || !upBody.id) {
        throw new Error(`youtube upload failed: HTTP ${up.status} ${JSON.stringify(upBody.error?.errors?.[0]?.reason ?? upBody.error?.message)}`);
      }

      return { platformPostId: upBody.id, platformPostUrl: `https://www.youtube.com/watch?v=${upBody.id}` };
    },
  };
}
