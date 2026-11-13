import { NonRetryableError } from "@autopilot/core";
import type { CommentSource, InboundComment } from "@autopilot/engagement";
import { assertNoLocationFields, getJson, PlatformRequestError, redactToken, type FetchLike } from "../http.js";
import { refreshAccessToken } from "../youtube.js";
import { commentCursorSince } from "./instagram.js";

export interface YouTubeCommentsConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Our channel id: `authorChannelId.value === channelId` marks our own comments. */
  channelId: string;
  fetch?: FetchLike;
  /** comments.insert needs the youtube.force-ssl scope, which we probably don't have (research.md:196). Default false. */
  canReply?: boolean;
  /** comments.setModerationStatus needs youtube.force-ssl too. Default false. */
  canModerate?: boolean;
}

export type YouTubeCommentSource = CommentSource & { readonly capabilities: { reply: boolean; hide: boolean } };

interface YtError {
  error?: { code?: number; message?: string; errors?: Array<{ reason?: string; message?: string }> };
}
interface YtCommentSnippet {
  videoId?: string;
  parentId?: string;
  textDisplay?: string;
  textOriginal?: string;
  authorDisplayName?: string;
  authorChannelId?: { value?: string };
  publishedAt?: string;
}
interface YtComment {
  id: string;
  snippet?: YtCommentSnippet;
}
interface YtThread {
  id: string;
  snippet?: { videoId?: string; channelId?: string; topLevelComment?: YtComment; totalReplyCount?: number };
  replies?: { comments?: YtComment[] };
}
interface YtList<T> extends YtError {
  items?: T[];
  nextPageToken?: string;
}

const API = "https://www.googleapis.com/youtube/v3";

function toIso(ts: string | undefined): string {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date(0).toISOString();
}

/**
 * YouTube comments via Data API v3. Reads cost 1 unit and work with youtube.readonly; reply and hide
 * (50 units each, youtube.force-ssl) exist only when enabled in config, so with the defaults the
 * methods are undefined and the send gate reports "no-capability". Never deletes.
 */
export function createYouTubeCommentSource(cfg: YouTubeCommentsConfig): YouTubeCommentSource {
  const fetchImpl = cfg.fetch ?? ((url, init) => fetch(url, init));
  const canReply = cfg.canReply ?? false;
  const canModerate = cfg.canModerate ?? false;

  async function token(signal?: AbortSignal): Promise<string> {
    return refreshAccessToken({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, refreshToken: cfg.refreshToken, fetch: fetchImpl }, signal);
  }

  function fail(what: string, status: number, body: YtError, access: string): never {
    const reasons = (body.error?.errors ?? []).map((e) => e.reason ?? "").filter(Boolean);
    const raw = `youtube ${what} failed: HTTP ${status} ${body.error?.message ?? JSON.stringify(body).slice(0, 300)}${reasons.length ? ` (${reasons.join(",")})` : ""}`;
    const msg = redactToken(raw).split(access).join("***");
    // Missing scope / disabled comments: no retry fixes these.
    const permanent = (status === 401 || status === 403) && reasons.some((r) => /insufficientPermissions|forbidden|commentsDisabled|ineligibleAccount/i.test(r));
    if (permanent || /insufficient.*scope/i.test(body.error?.message ?? "")) throw new NonRetryableError(msg);
    throw new PlatformRequestError("youtube", status, body, msg);
  }

  async function call<T extends YtError>(what: string, url: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
    const access = await token(signal);
    const r = await getJson<T>(fetchImpl, url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${access}` } }, signal);
    if (r.status >= 300 || r.body.error) fail(what, r.status, r.body, access);
    return r.body;
  }

  const isOurs = (c: YtComment): boolean => c.snippet?.authorChannelId?.value === cfg.channelId;
  const own = (cs: YtComment[]) => cs.filter(isOurs).map((c) => ({ platformCommentId: c.id, text: c.snippet?.textOriginal ?? c.snippet?.textDisplay ?? "", createdAt: toIso(c.snippet?.publishedAt) }));

  function toInbound(c: YtComment, videoId: string, parentId: string | undefined, ownReplies: InboundComment["ownRepliesInThread"]): InboundComment {
    const s = c.snippet ?? {};
    return {
      platform: "youtube",
      platformCommentId: c.id,
      platformMediaId: videoId,
      ...(parentId ? { parentId } : {}),
      authorId: s.authorChannelId?.value ?? null,
      ...(s.authorDisplayName ? { authorHandle: s.authorDisplayName } : {}),
      // textOriginal is only guaranteed for the comment's author; textDisplay is the fallback.
      text: s.textOriginal ?? s.textDisplay ?? "",
      createdAt: toIso(s.publishedAt),
      isOwn: isOurs(c),
      ownRepliesInThread: ownReplies,
    };
  }

  function flattenThread(t: YtThread, replies: YtComment[]): InboundComment[] {
    const top = t.snippet?.topLevelComment;
    if (!top) return [];
    const videoId = t.snippet?.videoId ?? top.snippet?.videoId ?? "";
    const out = [toInbound(top, videoId, undefined, own(replies))];
    for (const r of replies) out.push(toInbound(r, videoId, r.snippet?.parentId ?? top.id, own(replies.filter((x) => x.id !== r.id))));
    return out;
  }

  /** Replies must target the top-level comment (snippet.parentId of a reply is its thread). */
  async function threadIdOf(id: string, signal?: AbortSignal): Promise<string | null> {
    const r = await call<YtList<YtComment>>("comment lookup", `${API}/comments?part=snippet&id=${encodeURIComponent(id)}`, {}, signal);
    const c = r.items?.[0];
    if (!c) return null;
    return c.snippet?.parentId ?? c.id;
  }

  const source: YouTubeCommentSource = {
    platform: "youtube",
    capabilities: { reply: canReply, hide: canModerate },

    async fetchRecent(cursor, opts = {}) {
      const since = commentCursorSince(cursor);
      const sinceMs = since ? Date.parse(since) : -Infinity;
      // verified 2026-11-12 docs/research.md:196: commentThreads.list costs 1 unit, readonly scope is enough.
      const url = `${API}/commentThreads?part=snippet,replies&allThreadsRelatedToChannelId=${encodeURIComponent(cfg.channelId)}&maxResults=50&order=time`;
      const r = await call<YtList<YtThread>>("commentThreads.list", url, {}, opts.signal);
      const comments: InboundComment[] = [];
      let newest = since;
      for (const t of r.items ?? []) {
        for (const c of flattenThread(t, t.replies?.comments ?? [])) {
          const at = Date.parse(c.createdAt);
          if (at < sinceMs) continue; // >=: same-second comments are kept; the DB unique key dedupes
          comments.push(c);
          if (!newest || at > Date.parse(newest)) newest = c.createdAt;
        }
      }
      return { comments, cursor: newest ? { since: newest } : {} };
    },

    async fetchThread(platformCommentId, opts = {}) {
      const threadId = await threadIdOf(platformCommentId, opts.signal);
      if (!threadId) return null;
      const t = await call<YtList<YtThread>>("commentThreads.list", `${API}/commentThreads?part=snippet,replies&id=${encodeURIComponent(threadId)}`, {}, opts.signal);
      const thread = t.items?.[0];
      if (!thread) return null;
      // commentThreads.replies may be a subset; comments.list?parentId is the full list (1 unit) for the existence check.
      const all = await call<YtList<YtComment>>("comments.list", `${API}/comments?part=snippet&parentId=${encodeURIComponent(threadId)}&maxResults=100`, {}, opts.signal);
      const replies = all.items ?? thread.replies?.comments ?? [];
      return flattenThread(thread, replies).find((c) => c.platformCommentId === platformCommentId) ?? null;
    },
  };

  if (canReply) {
    /** verified 2026-11-12 docs/research.md:196: comments.insert, snippet.parentId, 50 units, youtube.force-ssl. */
    source.reply = async (platformCommentId, text, opts) => {
      const parentId = await threadIdOf(platformCommentId, opts.signal);
      if (!parentId) throw new NonRetryableError(`youtube reply: comment ${platformCommentId} no longer exists`);
      const body = { snippet: { parentId, textOriginal: text } };
      assertNoLocationFields("youtube", body);
      const r = await call<YtComment & YtError>("comments.insert", `${API}/comments?part=snippet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, opts.signal);
      if (!r.id) throw new PlatformRequestError("youtube", 200, r, "youtube comments.insert returned no id");
      return { platformReplyId: r.id };
    };
  }

  if (canModerate) {
    /** verified 2026-11-12 docs/research.md:196: setModerationStatus heldForReview, 50 units, youtube.force-ssl. Never rejects/bans. */
    source.hide = async (platformCommentId, opts = {}) => {
      await call<YtError>("comments.setModerationStatus", `${API}/comments/setModerationStatus?id=${encodeURIComponent(platformCommentId)}&moderationStatus=heldForReview`, { method: "POST" }, opts.signal);
    };
  }

  return source;
}
