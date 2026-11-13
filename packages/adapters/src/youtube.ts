import { NonRetryableError, type OutboxPost, type PlatformAdapter, type PublishOptions, type PublishResult } from "@autopilot/core";
import { assertNoLocationFields, countHashtags, getJson, PlatformRequestError, UploadAmbiguousError, type FetchLike } from "./http.js";

export interface YouTubeAdapterConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetch?: FetchLike;
  /** CLAUDE.md voice guide: 3 hashtags in the description. Hard stop above this. */
  maxHashtags?: number;
}

export async function refreshAccessToken(cfg: YouTubeAdapterConfig, signal?: AbortSignal): Promise<string> {
  const fetchImpl = cfg.fetch ?? ((url, init) => fetch(url, init));
  const r = await getJson<{ access_token?: string; error_description?: string; error?: string }>(
    fetchImpl,
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: cfg.refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token" }),
    },
    signal,
  );
  if (!r.body.access_token) {
    const msg = `youtube token refresh failed: ${r.body.error_description ?? r.body.error}`;
    // invalid_grant = the refresh token is revoked/expired: no retry fixes it, the creator must re-run probe:yt.
    if (r.body.error === "invalid_grant") throw new NonRetryableError(msg);
    throw new PlatformRequestError("youtube", r.status, r.body, msg);
  }
  return r.body.access_token;
}

/**
 * Uploads private + status.publishAt (YouTube holds the clock — CLAUDE.md platform routes), streaming
 * the R2-hosted file straight into the resumable upload. Never sets recordingDetails (location boundary).
 * No findExisting: research.md documents no lookup by our key, so a timed-out upload stays "unknown"
 * until checked in YouTube Studio (night log needsAttention).
 */
export function createYouTubeAdapter(cfg: YouTubeAdapterConfig): PlatformAdapter {
  const fetchImpl = cfg.fetch ?? ((url, init) => fetch(url, init));
  const maxHashtags = cfg.maxHashtags ?? 5;
  return {
    platform: "youtube",
    async publish(post: OutboxPost, opts: PublishOptions = {}): Promise<PublishResult> {
      const signal = opts.signal;
      if (countHashtags(post.caption) > maxHashtags) throw new NonRetryableError(`youtube: description has more than ${maxHashtags} hashtags`);
      const title = post.title ?? post.caption.split("\n")[0]!.slice(0, 60);
      if (title.length > 100) throw new NonRetryableError("youtube: title longer than 100 characters");

      const access = await refreshAccessToken(cfg, signal);
      const auth = { Authorization: `Bearer ${access}` };

      const meta = {
        snippet: { title, description: post.caption, categoryId: "22" },
        status: { privacyStatus: "private", selfDeclaredMadeForKids: false, publishAt: post.scheduledFor },
      };
      assertNoLocationFields("youtube", meta);
      const init = await fetchImpl("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json", "X-Upload-Content-Type": "video/*" },
        body: JSON.stringify(meta),
        ...(signal ? { signal } : {}),
      });
      const location = init.headers.get("location");
      if (!location) {
        const text = await init.text();
        throw new PlatformRequestError("youtube", init.status, text, `youtube upload init failed: HTTP ${init.status} ${text.slice(0, 200)}`);
      }

      const source = await fetchImpl(post.mediaUrl, signal ? { signal } : {});
      if (!source.ok || !source.body) throw new Error(`could not fetch media for upload: HTTP ${source.status}`);
      const contentLength = source.headers.get("content-length");

      // F7 A4: from here on the bytes may have landed. YouTube has no lookup by our key, so anything other
      // than a clear validation refusal is ambiguous → UploadAmbiguousError (timeout-class → "unknown").
      let up: Response;
      let upBody: { id?: string; error?: { message?: string; errors?: Array<{ reason?: string }> } };
      try {
        up = await fetchImpl(location, {
          method: "PUT",
          headers: { "Content-Type": "video/*", ...(contentLength ? { "Content-Length": contentLength } : {}) },
          body: source.body,
          duplex: "half",
          ...(signal ? { signal } : {}),
        } as RequestInit & { duplex: "half" });
      } catch (e) {
        const name = (e as { name?: string } | undefined)?.name;
        if (e instanceof TypeError || name === "TimeoutError" || name === "AbortError") throw e; // already timeout-class
        throw new UploadAmbiguousError("youtube", `youtube upload outcome unknown: ${(e as Error)?.message ?? String(e)}`, undefined, undefined, { cause: e });
      }
      const text = await up.text().catch(() => "");
      try {
        upBody = (text ? JSON.parse(text) : {}) as typeof upBody;
      } catch {
        throw new UploadAmbiguousError("youtube", `youtube upload outcome unknown: HTTP ${up.status}, unparseable response`, up.status, text.slice(0, 200));
      }
      if (up.status !== 200 || !upBody.id) {
        const reason = upBody.error?.errors?.[0]?.reason ?? upBody.error?.message;
        const msg = `youtube upload failed: HTTP ${up.status} ${JSON.stringify(reason)}`;
        // Explicit validation refusals: nothing was created, and a retry can't fix them.
        if (reason === "invalidPublishAt" || reason === "invalidTitle" || reason === "invalidDescription") throw new NonRetryableError(msg);
        throw new UploadAmbiguousError("youtube", `${msg} — outcome unknown, check YouTube Studio`, up.status, upBody);
      }

      return { platformPostId: upBody.id, platformPostUrl: `https://www.youtube.com/watch?v=${upBody.id}` };
    },
  };
}
