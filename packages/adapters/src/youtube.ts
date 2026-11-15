import { NonRetryableError, type OutboxPost, type PlatformAdapter, type PublishOptions, type PublishResult } from "@autopilot/core";
import { assertNoLocationFields, countHashtags, getJson, PlatformRequestError, UploadAmbiguousError, type FetchLike } from "./http.js";
import { normaliseCaption } from "./instagram.js";

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

/** The title publish() sends: the post's title, else the caption's first line (60 chars). findExisting matches on the same value. */
export function youtubeTitle(post: OutboxPost): string {
  return post.title ?? post.caption.split("\n")[0]!.slice(0, 60);
}

const API = "https://www.googleapis.com/youtube/v3";
const HOUR = 3_600_000;
/**
 * findExisting window on playlistItem `snippet.publishedAt` ("the date and time that the item was added to
 * the playlist", i.e. upload time — NOT the scheduled publish time). The playlistItems resource carries no
 * `status.publishAt`, and `contentDetails.videoPublishedAt` is the go-public time (absent until a scheduled
 * video goes live), so we match on upload time: we hand off ~24 h ahead (nativeLeadMs), retries come later,
 * so an upload of this post lands in [scheduledFor − 14 d, scheduledFor + 36 h].
 */
export const YT_LOOKUP_WINDOW = { beforeMs: 14 * 24 * HOUR, afterMs: 36 * HOUR } as const;

interface YtError {
  error?: { message?: string; errors?: Array<{ reason?: string }> };
}
interface ChannelList extends YtError {
  items?: Array<{ id?: string; contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
}
interface PlaylistItemList extends YtError {
  items?: Array<{ snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } }; status?: { privacyStatus?: string } }>;
}

/**
 * Uploads private + status.publishAt (YouTube holds the clock — CLAUDE.md platform routes), streaming
 * the R2-hosted file straight into the resumable upload. Never sets recordingDetails (location boundary).
 * findExisting (F13 T3): title match on the owner's uploads playlist. A timed-out upload still goes
 * "unknown" (the engine never resends a timeout); the lookup only settles retries and crashed attempts.
 */
export function createYouTubeAdapter(cfg: YouTubeAdapterConfig): PlatformAdapter {
  const fetchImpl = cfg.fetch ?? ((url, init) => fetch(url, init));
  const maxHashtags = cfg.maxHashtags ?? 5;
  /** The channel's uploads playlist id never changes, so it's looked up once per adapter instance. */
  let uploadsPlaylistId: string | undefined;

  const lookupFailed = (step: string, status: number, body: unknown, why: string): PlatformRequestError =>
    new PlatformRequestError("youtube", status, body, `youtube existence check (${step}) failed: ${why} — outcome stays unknown, not "not found"`);
  return {
    platform: "youtube",
    async publish(post: OutboxPost, opts: PublishOptions = {}): Promise<PublishResult> {
      const signal = opts.signal;
      if (countHashtags(post.caption) > maxHashtags) throw new NonRetryableError(`youtube: description has more than ${maxHashtags} hashtags`);
      const title = youtubeTitle(post);
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

    /**
     * Does this post already sit on the channel? GET-only, read-only (youtube.upload/force-ssl cover it):
     *   1. channels.list?part=contentDetails&mine=true → contentDetails.relatedPlaylists.uploads (cached)
     *   2. playlistItems.list?part=snippet,status&playlistId=<uploads>&maxResults=25 (one page, no paging)
     * Match: normalised snippet.title === normalised youtubeTitle(post) AND snippet.publishedAt (upload time)
     * inside YT_LOOKUP_WINDOW. Quota: list calls cost 1 unit each per Google's quota table as recorded in
     * research.md (not re-read this session) → 2 units on the first lookup, 1 after (cached playlist id).
     * Contract with the engine: hit → result; clean miss → null; any non-2xx, malformed body, or a title
     * match without a readable upload time → throws PlatformRequestError (the engine re-queues the
     * lookup / marks a stale row unknown — never treats it as "not found"). Unverified (research.md):
     * whether private/scheduled uploads always appear here, and how fast — a miss is not proof of absence.
     */
    async findExisting(post: OutboxPost, opts: PublishOptions = {}): Promise<PublishResult | null> {
      const signal = opts.signal;
      const target = normaliseCaption(youtubeTitle(post));
      if (!target) return null;
      const at = Date.parse(post.scheduledFor);
      if (!Number.isFinite(at)) throw lookupFailed("input", 0, null, `unparseable scheduledFor ${JSON.stringify(post.scheduledFor)}`);

      const access = await refreshAccessToken(cfg, signal);
      const auth = { Authorization: `Bearer ${access}` };

      if (!uploadsPlaylistId) {
        const ch = await getJson<ChannelList>(fetchImpl, `${API}/channels?part=contentDetails&mine=true`, { method: "GET", headers: auth }, signal);
        if (ch.status < 200 || ch.status >= 300) throw lookupFailed("channels.list", ch.status, ch.body, `HTTP ${ch.status} ${JSON.stringify(ch.body.error?.errors?.[0]?.reason ?? ch.body.error?.message ?? "")}`);
        const uploads = ch.body.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        if (typeof uploads !== "string" || !uploads) throw lookupFailed("channels.list", ch.status, ch.body, "no contentDetails.relatedPlaylists.uploads in the response");
        uploadsPlaylistId = uploads;
      }

      const pl = await getJson<PlaylistItemList>(
        fetchImpl,
        `${API}/playlistItems?part=snippet,status&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=25`,
        { method: "GET", headers: auth },
        signal,
      );
      if (pl.status < 200 || pl.status >= 300) throw lookupFailed("playlistItems.list", pl.status, pl.body, `HTTP ${pl.status} ${JSON.stringify(pl.body.error?.errors?.[0]?.reason ?? pl.body.error?.message ?? "")}`);
      if (!Array.isArray(pl.body.items)) throw lookupFailed("playlistItems.list", pl.status, pl.body, "response has no items array");

      for (const item of pl.body.items) {
        const sn = item?.snippet;
        if (!sn || typeof sn.title !== "string" || normaliseCaption(sn.title) !== target) continue;
        const videoId = sn.resourceId?.videoId;
        const uploadedAt = typeof sn.publishedAt === "string" ? Date.parse(sn.publishedAt) : NaN;
        // A title match we can't place in time (or can't point at) is uncertainty, not absence.
        if (!videoId || !Number.isFinite(uploadedAt)) throw lookupFailed("playlistItems.list", pl.status, pl.body, "title match without snippet.publishedAt / resourceId.videoId");
        if (uploadedAt < at - YT_LOOKUP_WINDOW.beforeMs || uploadedAt > at + YT_LOOKUP_WINDOW.afterMs) continue;
        return { platformPostId: videoId, platformPostUrl: `https://www.youtube.com/watch?v=${videoId}` };
      }
      return null;
    },
  };
}
