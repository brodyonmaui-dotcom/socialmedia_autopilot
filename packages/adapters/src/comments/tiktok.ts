import { NonRetryableError } from "@autopilot/core";
import type { CommentSource, InboundComment } from "@autopilot/engagement";
import { getJson, PlatformRequestError, redactToken, UploadAmbiguousError, type FetchLike, type JsonResult } from "../http.js";
import { commentCursorSince } from "./instagram.js";

const DISABLED = "tiktok comments disabled: no Zernio credentials (ZERNIO_API_KEY, ZERNIO_TIKTOK_ACCOUNT_ID)";
/** Shown in the Inbox / Platforms page when a TikTok reply waits on the stub. */
export const TIKTOK_NOT_CONNECTED = "TikTok isn't connected on the server (ZERNIO_API_KEY and ZERNIO_TIKTOK_ACCOUNT_ID needed)";
const NOT_CONNECTED = TIKTOK_NOT_CONNECTED;

export interface TikTokCommentsConfig {
  apiKey: string;
  /** Zernio account id of the TikTok connection (ZERNIO_TIKTOK_ACCOUNT_ID). */
  accountId: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Newest posts whose threads are read per poll (default 10). */
  maxPosts?: number;
  log?: (line: string) => void;
}

interface ZernioError {
  error?: { message?: string; code?: string } | string;
  code?: string;
  message?: string;
}
interface ZernioCommentedPost {
  id?: string;
  platform?: string;
  accountId?: string;
  commentCount?: number;
  createdTime?: string;
}
interface ZernioCommentedPosts extends ZernioError {
  data?: ZernioCommentedPost[];
  pagination?: { hasMore?: boolean; nextCursor?: string | null };
  meta?: { accountsSkipped?: unknown };
}
interface ZernioComment {
  id: string;
  message?: string;
  createdTime?: string;
  from?: { id?: string; username?: string; name?: string; isOwner?: boolean };
  likeCount?: number;
  replyCount?: number;
  replies?: ZernioComment[];
  repliesHasMore?: boolean;
  canReply?: boolean;
  isHidden?: boolean;
}
interface ZernioPostComments extends ZernioError {
  comments?: ZernioComment[];
  pagination?: { hasMore?: boolean; cursor?: string | null };
}
interface ZernioReply extends ZernioError {
  success?: boolean;
  data?: { commentId?: string; isReply?: boolean };
}

/**
 * Our comment ids are `<postId>:<topCommentId>` (a top-level comment) or `<postId>:<topCommentId>:<replyId>`
 * (a reply). TikTok has no parentId (replies are nested), and every Zernio call needs the post id, so the id
 * carries both. TikTok post ids are numeric, so ':' never collides.
 */
export function tiktokCommentKey(postId: string, topId: string, replyId?: string): string {
  return replyId ? `${postId}:${topId}:${replyId}` : `${postId}:${topId}`;
}
export function parseTikTokCommentKey(key: string): { postId: string; topId: string; replyId?: string } | null {
  const [postId, topId, replyId, ...rest] = key.split(":");
  if (!postId || !topId || rest.length) return null;
  return replyId ? { postId, topId, replyId } : { postId, topId };
}

/** Zernio's comment lists are cached up to 10 min, so a late comment can carry an older createdTime. */
const LAG_MS = 15 * 60_000;
const PAGE = 50;
const MAX_THREAD_PAGES = 5;

function toIso(ts: string | undefined): string {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date(0).toISOString();
}

function errCode(body: ZernioError): string | undefined {
  return (typeof body.error === "object" ? body.error?.code : undefined) ?? body.code;
}
function errText(body: ZernioError): string {
  return (typeof body.error === "string" ? body.error : body.error?.message) ?? body.message ?? JSON.stringify(body).slice(0, 300);
}

/**
 * TikTok comments through Zernio's Comments API (docs.zernio.com/products/comments, research.md 2026-11-22).
 * Only Business-app connections are served; otherwise Zernio answers 400 PLATFORM_LIMITATION (or lists the
 * account under meta.accountsSkipped) and the source logs one line and returns nothing from then on.
 * Never hides, likes or deletes. reply() runs only through the send gate (live mode or the creator's Approve).
 *
 * Ids (verified 2026-11-25 against docs.zernio.com, research.md "Zernio comment ids"): the postId for
 * GET/POST /v1/inbox/comments/{postId} is the list row's `id` from GET /v1/inbox/comments ("Pass a row's `id`
 * and `accountId` to Get post comments"); for TikTok that is the TikTok video id, and Zernio also auto-resolves
 * its own post ids. The list has no separate platformPostId field. accountId is required on both: query on GET,
 * body on POST ({accountId, commentId, message}).
 *
 * Without a config this is a placeholder: polling returns nothing, there is no reply/hide (the send tick shows
 * "TikTok isn't connected on the server"), and fetchThread refuses.
 */
export function createTikTokCommentSource(cfg?: TikTokCommentsConfig): CommentSource {
  if (!cfg) {
    // No reply/hide: the send tick sees "no capability" and tells the creator what's missing (no silent hold).
    return {
      platform: "tiktok",
      placeholder: true,
      replyUnavailableReason: NOT_CONNECTED,
      async fetchRecent(cursor) {
        return { comments: [], cursor };
      },
      async fetchThread() {
        throw new NonRetryableError(DISABLED);
      },
    };
  }

  const fetchImpl = cfg.fetch ?? ((url, init) => fetch(url, init));
  const base = cfg.baseUrl ?? "https://zernio.com/api/v1";
  const maxPosts = cfg.maxPosts ?? 10;
  const log = cfg.log ?? console.log;
  const acct = encodeURIComponent(cfg.accountId);
  let unavailable = false;

  const markUnavailable = (why: string) => {
    if (!unavailable) log(`[engage] tiktok comments: source unavailable (${why}); connect TikTok through the Business app in Zernio`);
    unavailable = true;
  };

  function fail(what: string, status: number, body: ZernioError): never {
    const msg = redactToken(`tiktok (zernio) ${what} failed: HTTP ${status} ${errCode(body) ?? ""} ${errText(body)}`.replace(/\s+/g, " ").trim()).split(cfg!.apiKey).join("***");
    if (errCode(body) === "PLATFORM_LIMITATION") throw new NonRetryableError(msg);
    // 429 (Retry-After) and 5xx retry; other 4xx won't get better by retrying.
    if (status === 429 || status >= 500) throw new PlatformRequestError("tiktok", status, body, msg);
    throw new NonRetryableError(msg);
  }

  async function call<T extends ZernioError>(what: string, url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
    const headers = { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${cfg!.apiKey}` };
    const r = await getJson<T>(fetchImpl, url, { ...init, headers }, signal);
    if (r.status >= 300) fail(what, r.status, r.body);
    return r.body;
  }

  const ownReplies = (rs: ZernioComment[]): InboundComment["ownRepliesInThread"] =>
    rs.filter((r) => r.from?.isOwner === true).map((r) => ({ platformCommentId: r.id, text: r.message ?? "", createdAt: toIso(r.createdTime) }));

  function toInbound(c: ZernioComment, postId: string, key: string, parentKey: string | undefined, own: InboundComment["ownRepliesInThread"]): InboundComment {
    const handle = c.from?.username ?? c.from?.name;
    return {
      platform: "tiktok",
      platformCommentId: key,
      platformMediaId: postId,
      ...(parentKey ? { parentId: parentKey } : {}),
      authorId: c.from?.id ?? null,
      ...(handle ? { authorHandle: handle } : {}),
      text: c.message ?? "",
      createdAt: toIso(c.createdTime),
      isOwn: c.from?.isOwner === true,
      ownRepliesInThread: own,
    };
  }

  /** Top comment + its replies, as InboundComments. Hidden comments are left out (nothing to draft for them). */
  function flatten(postId: string, top: ZernioComment, replies: ZernioComment[]): InboundComment[] {
    const topKey = tiktokCommentKey(postId, top.id);
    const out: InboundComment[] = [];
    if (!top.isHidden) out.push(toInbound(top, postId, topKey, undefined, ownReplies(replies)));
    for (const r of replies) {
      if (r.isHidden) continue;
      out.push(toInbound(r, postId, tiktokCommentKey(postId, top.id, r.id), topKey, ownReplies(replies.filter((x) => x.id !== r.id))));
    }
    return out;
  }

  async function threadPage(postId: string, extra: string, signal?: AbortSignal): Promise<ZernioPostComments> {
    return call<ZernioPostComments>("comments.get", `${base}/inbox/comments/${encodeURIComponent(postId)}?accountId=${acct}&limit=${PAGE}${extra}`, {}, signal);
  }

  /** Every reply of one top-level comment (`commentId` query: TikTok returns its replies in comments[]). */
  async function allReplies(postId: string, top: ZernioComment, signal?: AbortSignal): Promise<ZernioComment[]> {
    const inline = top.replies ?? [];
    if (!top.repliesHasMore && (top.replyCount ?? 0) <= inline.length) return inline;
    const out: ZernioComment[] = [];
    let cursor: string | null | undefined;
    for (let i = 0; i < MAX_THREAD_PAGES; i++) {
      const page = await threadPage(postId, `&commentId=${encodeURIComponent(top.id)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, signal);
      out.push(...(page.comments ?? []));
      cursor = page.pagination?.hasMore ? page.pagination.cursor : null;
      if (!cursor) break;
    }
    return out.length ? out : inline;
  }

  async function fetchRecentInner(cursor: unknown, signal?: AbortSignal): Promise<{ comments: InboundComment[]; cursor: unknown }> {
    const since = commentCursorSince(cursor);
    const sinceMs = since ? Date.parse(since) - LAG_MS : -Infinity;
    // verified 2026-11-22 docs/research.md "TikTok comments via Zernio": newest posts with comments first.
    const posts = await call<ZernioCommentedPosts>("comments.list", `${base}/inbox/comments?platform=tiktok&accountId=${acct}&limit=${maxPosts}&view=summary`, {}, signal);
    if (JSON.stringify(posts.meta?.accountsSkipped ?? []).includes(cfg!.accountId)) {
      markUnavailable("account skipped: not a Business-app connection");
      return { comments: [], cursor };
    }
    const comments: InboundComment[] = [];
    let newest = since;
    for (const p of (posts.data ?? []).slice(0, maxPosts)) {
      if (!p.id || (p.platform && p.platform !== "tiktok") || p.commentCount === 0) continue;
      const thread = await threadPage(p.id, "&view=summary", signal);
      for (const top of thread.comments ?? []) {
        // view=summary carries ≤3 replies inline; the poll takes what's there (later polls see the rest as they move up).
        for (const c of flatten(p.id, top, top.replies ?? [])) {
          const at = Date.parse(c.createdAt);
          if (at < sinceMs) continue; // overlap for Zernio's cache lag; the DB unique key dedupes
          comments.push(c);
          if (!newest || at > Date.parse(newest)) newest = c.createdAt;
        }
      }
    }
    return { comments, cursor: newest ? { since: newest } : {} };
  }

  return {
    platform: "tiktok",

    async fetchRecent(cursor, opts = {}) {
      if (unavailable) return { comments: [], cursor };
      try {
        return await fetchRecentInner(cursor, opts.signal);
      } catch (err) {
        if (err instanceof NonRetryableError && /PLATFORM_LIMITATION/.test(err.message)) {
          markUnavailable("PLATFORM_LIMITATION");
          return { comments: [], cursor };
        }
        throw err;
      }
    },

    /** Re-reads the comment and its full reply list (the existence check before any retry). */
    async fetchThread(platformCommentId, opts = {}) {
      const k = parseTikTokCommentKey(platformCommentId);
      if (!k) return null;
      let cursor: string | null | undefined;
      for (let i = 0; i < MAX_THREAD_PAGES; i++) {
        const page = await threadPage(k.postId, cursor ? `&cursor=${encodeURIComponent(cursor)}` : "", opts.signal);
        const top = (page.comments ?? []).find((c) => c.id === k.topId);
        if (top) {
          const replies = await allReplies(k.postId, top, opts.signal);
          return flatten(k.postId, top, replies).find((c) => c.platformCommentId === platformCommentId) ?? null;
        }
        cursor = page.pagination?.hasMore ? page.pagination.cursor : null;
        if (!cursor) break;
      }
      return null;
    },

    /** verified 2026-11-22: POST /v1/inbox/comments/{postId} {accountId, commentId, message}; replies go under the top-level comment. */
    async reply(platformCommentId, text, opts) {
      const k = parseTikTokCommentKey(platformCommentId);
      if (!k) throw new NonRetryableError(`tiktok reply: bad comment id ${platformCommentId}`);
      const body = { accountId: cfg.accountId, commentId: k.topId, message: text };
      // Audit #3: Zernio's Idempotency-Key on this endpoint isn't verified, so once the POST has left, a 5xx or a
      // network error means "may have posted": UploadAmbiguousError (TimeoutError-class) → the send tick marks it
      // unknown + engagement-unknown alert and never resends. 4xx stays a failure; 429 (nothing accepted) may retry.
      const redact = (m: string) => redactToken(m).split(cfg!.apiKey).join("***");
      let r: JsonResult<ZernioReply>;
      try {
        r = await getJson<ZernioReply>(
          fetchImpl,
          `${base}/inbox/comments/${encodeURIComponent(k.postId)}`,
          { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": opts.idempotencyKey, Authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify(body) },
          opts.signal,
        );
      } catch (err) {
        if ((err as { name?: string } | undefined)?.name === "AbortError") throw err; // the tick's own deadline: already unknown-class
        throw new UploadAmbiguousError("tiktok", redact(`tiktok (zernio) comments.reply: no response (${(err as Error)?.message ?? "network error"}); outcome unknown, not resent`), undefined, undefined, { cause: err });
      }
      if (r.status >= 500) {
        throw new UploadAmbiguousError("tiktok", redact(`tiktok (zernio) comments.reply: HTTP ${r.status} ${errCode(r.body) ?? ""} ${errText(r.body)}; outcome unknown, not resent`.replace(/\s+/g, " ").trim()), r.status, r.body);
      }
      if (r.status >= 300) fail("comments.reply", r.status, r.body);
      const id = r.body.data?.commentId;
      if (r.body.success === false || !id) throw new PlatformRequestError("tiktok", 200, r.body, "tiktok (zernio) reply returned no comment id");
      return { platformReplyId: tiktokCommentKey(k.postId, k.topId, id) };
    },
  };
}
