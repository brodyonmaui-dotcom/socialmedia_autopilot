import { NonRetryableError } from "@autopilot/core";
import type { CommentSource, InboundComment } from "@autopilot/engagement";
import { assertNoLocationFields, getJson, PlatformRequestError, redactToken, type FetchLike } from "../http.js";

export interface InstagramCommentsConfig {
  /** Page access token (Facebook Login). Sent only as a Bearer header, never in a URL. */
  accessToken: string;
  /** The IG professional account id: `from.id === igUserId` marks our own comments. */
  igUserId: string;
  graphVersion?: string;
  fetch?: FetchLike;
  /** How many recent media to scan per poll (default 25, same shape as the outbox findExisting). */
  mediaLimit?: number;
}

interface GraphError {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
}
interface IgFrom {
  id?: string;
  username?: string;
}
interface IgCommentNode {
  id: string;
  text?: string;
  timestamp?: string;
  parent_id?: string;
  hidden?: boolean;
  like_count?: number;
  from?: IgFrom;
  username?: string;
  media?: { id?: string };
  replies?: { data?: IgCommentNode[] };
}
interface IgList<T> extends GraphError {
  data?: T[];
}

/** Cursor for fetchRecent: the newest comment timestamp seen so far (ISO). */
export interface InstagramCommentsCursor {
  since?: string;
}

// verified 2026-11-12 docs/research.md:192 (fields; `from` may be absent in Development mode)
const REPLY_FIELDS = "id,text,timestamp,from{id,username},username";
const COMMENT_FIELDS = `id,text,timestamp,parent_id,hidden,like_count,from{id,username},username,replies{${REPLY_FIELDS}}`;

function toIso(ts: string | undefined): string {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date(0).toISOString();
}

/** Reads `{ since }` from an opaque cursor (shared by the comment and DM sources). */
export function commentCursorSince(cursor: unknown): string | undefined {
  if (cursor && typeof cursor === "object" && typeof (cursor as InstagramCommentsCursor).since === "string") return (cursor as InstagramCommentsCursor).since;
  return undefined;
}

/**
 * Instagram comments via the Graph API (Facebook Login). Reads are GET only; reply/hide are the only
 * POSTs and only ever send a plain form (no location fields). There is no delete method (never delete).
 */
export function createInstagramCommentSource(cfg: InstagramCommentsConfig): CommentSource {
  const fetchImpl = cfg.fetch ?? ((url, init) => fetch(url, init));
  const base = `https://graph.facebook.com/${cfg.graphVersion ?? "v25.0"}`;
  const auth = { Authorization: `Bearer ${cfg.accessToken}` };
  const mediaLimit = cfg.mediaLimit ?? 25;

  const redact = (s: string): string => (cfg.accessToken ? redactToken(s).split(cfg.accessToken).join("***") : redactToken(s));

  /** Throws on a Graph error: permission problems are NonRetryable (no retry fixes a missing scope). */
  function fail(what: string, status: number, body: GraphError): never {
    const e = body.error;
    const raw = `instagram ${what} failed: HTTP ${status} ${e?.message ?? JSON.stringify(body).slice(0, 300)} (code ${e?.code}/${e?.error_subcode})`;
    const msg = redact(raw);
    const permission = e?.code === 10 || e?.code === 200 || /permission|\(#200\)/i.test(e?.message ?? JSON.stringify(body));
    if (status >= 400 && status < 500 && permission) throw new NonRetryableError(msg);
    throw new PlatformRequestError("instagram", status, JSON.parse(redact(JSON.stringify(body))), msg);
  }

  async function get<T extends GraphError>(what: string, path: string, signal?: AbortSignal): Promise<{ status: number; body: T }> {
    const r = await getJson<T>(fetchImpl, `${base}/${path}`, { headers: auth }, signal);
    if (r.status >= 300 || r.body.error) fail(what, r.status, r.body);
    return r;
  }

  async function post<T extends GraphError>(what: string, path: string, form: Record<string, string>, signal?: AbortSignal): Promise<T> {
    assertNoLocationFields("instagram", form);
    // Plain URL-encoded form body: the text never goes into the query string (or logs of URLs).
    const r = await getJson<T>(fetchImpl, `${base}/${path}`, { method: "POST", headers: auth, body: new URLSearchParams(form) }, signal);
    if (r.status >= 300 || r.body.error) fail(what, r.status, r.body);
    return r.body;
  }

  const isOurs = (n: IgCommentNode): boolean => n.from?.id === cfg.igUserId;
  const own = (nodes: IgCommentNode[]) => nodes.filter(isOurs).map((n) => ({ platformCommentId: n.id, text: n.text ?? "", createdAt: toIso(n.timestamp) }));

  function toInbound(n: IgCommentNode, mediaId: string, parentId: string | undefined, ownReplies: InboundComment["ownRepliesInThread"]): InboundComment {
    const handle = n.from?.username ?? n.username;
    return {
      platform: "instagram",
      platformCommentId: n.id,
      platformMediaId: mediaId,
      ...(parentId ? { parentId } : {}),
      authorId: n.from?.id ?? null, // Development mode may omit `from` (research.md:192)
      ...(handle ? { authorHandle: handle } : {}),
      text: n.text ?? "",
      createdAt: toIso(n.timestamp),
      isOwn: isOurs(n),
      ownRepliesInThread: ownReplies,
    };
  }

  /** Top-level + nested replies, flattened. A reply's ownRepliesInThread = our sibling replies (not itself). */
  function flatten(top: IgCommentNode, mediaId: string, replies: IgCommentNode[]): InboundComment[] {
    const out = [toInbound(top, mediaId, undefined, own(replies))];
    for (const r of replies) out.push(toInbound(r, mediaId, r.parent_id ?? top.id, own(replies.filter((x) => x.id !== r.id))));
    return out;
  }

  /** The top-level comment a reply must target: IG replies are top-level only (research.md:193). */
  async function topLevelOf(id: string, signal?: AbortSignal): Promise<string> {
    const r = await get<IgCommentNode & GraphError>("comment lookup", `${id}?fields=id,parent_id`, signal);
    return r.body.parent_id ?? id;
  }

  return {
    platform: "instagram",

    async fetchRecent(cursor, opts = {}) {
      const since = commentCursorSince(cursor);
      const sinceMs = since ? Date.parse(since) : -Infinity;
      // Same media-list shape as the outbox adapter's findExisting (instagram.ts).
      const media = await get<IgList<{ id: string }>>("media list", `${cfg.igUserId}/media?fields=id,caption,timestamp&limit=${mediaLimit}`, opts.signal);
      const comments: InboundComment[] = [];
      let newest = since;
      for (const m of media.body.data ?? []) {
        // verified 2026-11-12 docs/research.md:192: top-level only, newest first, max 50 per query.
        const r = await get<IgList<IgCommentNode>>("comments list", `${m.id}/comments?fields=${COMMENT_FIELDS}&limit=50`, opts.signal);
        for (const top of r.body.data ?? []) {
          for (const c of flatten(top, m.id, top.replies?.data ?? [])) {
            const at = Date.parse(c.createdAt);
            // >= (not >): a comment in the same second as the cursor is kept; the DB unique key dedupes it.
            if (at < sinceMs) continue;
            comments.push(c);
            if (!newest || at > Date.parse(newest)) newest = c.createdAt;
          }
        }
      }
      return { comments, cursor: newest ? { since: newest } : {} };
    },

    async fetchThread(platformCommentId, opts = {}) {
      const r = await getJson<IgCommentNode & GraphError>(
        fetchImpl,
        `${base}/${platformCommentId}?fields=id,text,timestamp,parent_id,from{id,username},username,media{id}`,
        { headers: auth },
        opts.signal,
      );
      // Code 100 = object does not exist / was deleted → gone.
      if (r.body.error?.code === 100 || r.status === 404) return null;
      if (r.status >= 300 || r.body.error) fail("comment lookup", r.status, r.body);
      const c = r.body;
      const threadRoot = c.parent_id ?? c.id;
      // verified 2026-11-12 docs/research.md:193: existence check = GET /{ig-comment-id}/replies.
      const replies = await get<IgList<IgCommentNode>>("replies list", `${threadRoot}/replies?fields=${REPLY_FIELDS}`, opts.signal);
      const siblings = (replies.body.data ?? []).filter((x) => x.id !== c.id);
      return toInbound(c, c.media?.id ?? "", c.parent_id, own(siblings));
    },

    /**
     * verified 2026-11-12 docs/research.md:193: POST /{ig-comment-id}/replies (message) → {id}.
     * IG has no idempotency key: the caller's existence check is fetchThread().ownRepliesInThread.
     */
    async reply(platformCommentId, text, opts) {
      const target = await topLevelOf(platformCommentId, opts.signal);
      const body = await post<{ id?: string } & GraphError>("reply", `${target}/replies`, { message: text }, opts.signal);
      if (!body.id) throw new PlatformRequestError("instagram", 200, body, "instagram reply returned no id");
      return { platformReplyId: body.id };
    },

    /** verified 2026-11-12 docs/research.md:194: POST /{ig-comment-id}?hide=true → {success:true}. */
    async hide(platformCommentId, opts = {}) {
      const body = await post<{ success?: boolean } & GraphError>("hide", platformCommentId, { hide: "true" }, opts.signal);
      if (body.success !== true) throw new PlatformRequestError("instagram", 200, body, "instagram hide did not return success");
    },
  };
}
