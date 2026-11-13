import { NonRetryableError } from "@autopilot/core";
import type { DmMessage, DmSource, DmThreadInput } from "@autopilot/engagement";
import { getJson, PlatformRequestError, redactToken, type FetchLike } from "../http.js";
import { commentCursorSince } from "./instagram.js";

export interface InstagramDmConfig {
  accessToken: string;
  igUserId: string;
  graphVersion?: string;
  fetch?: FetchLike;
}

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number };
}
interface IgUser {
  id?: string;
  username?: string;
}
interface Conversation {
  id: string;
  updated_time?: string;
  participants?: { data?: IgUser[] };
}
interface Message {
  id: string;
  created_time?: string;
  from?: IgUser;
  to?: { data?: IgUser[] };
  message?: string;
}

function toIso(ts: string | undefined): string {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date(0).toISOString();
}

/**
 * Instagram DMs, READ ONLY (F3: he sends every DM himself). The returned object has exactly one
 * method, fetchThreads; there is deliberately no send path anywhere in this module.
 * verified 2026-11-12 docs/research.md:195: conversations list + /{conversation-id}?fields=messages,
 * only the 20 most recent messages per thread; access in Development mode is unverified (dm-poll off by default).
 */
export function createInstagramDmSource(cfg: InstagramDmConfig): DmSource {
  const fetchImpl = cfg.fetch ?? ((url, init) => fetch(url, init));
  const base = `https://graph.facebook.com/${cfg.graphVersion ?? "v25.0"}`;
  const auth = { Authorization: `Bearer ${cfg.accessToken}` };
  const redact = (s: string): string => (cfg.accessToken ? redactToken(s).split(cfg.accessToken).join("***") : redactToken(s));

  async function get<T extends GraphError>(what: string, path: string, signal?: AbortSignal): Promise<T> {
    const r = await getJson<T>(fetchImpl, `${base}/${path}`, { headers: auth }, signal);
    if (r.status >= 300 || r.body.error) {
      const e = r.body.error;
      const msg = redact(`instagram ${what} failed: HTTP ${r.status} ${e?.message ?? JSON.stringify(r.body).slice(0, 300)} (code ${e?.code}/${e?.error_subcode})`);
      if (r.status >= 400 && r.status < 500 && (e?.code === 10 || e?.code === 200 || /permission|\(#200\)/i.test(e?.message ?? ""))) throw new NonRetryableError(msg);
      throw new PlatformRequestError("instagram", r.status, JSON.parse(redact(JSON.stringify(r.body))), msg);
    }
    return r.body;
  }

  return {
    async fetchThreads(cursor, opts = {}) {
      const since = commentCursorSince(cursor);
      const sinceMs = since ? Date.parse(since) : -Infinity;
      const list = await get<{ data?: Conversation[] } & GraphError>("conversations list", `${cfg.igUserId}/conversations?platform=instagram&fields=id,participants,updated_time`, opts.signal);
      const threads: DmThreadInput[] = [];
      let newest = since;
      for (const conv of list.data ?? []) {
        const updated = toIso(conv.updated_time);
        if (Date.parse(updated) < sinceMs) continue; // unchanged since the last poll (>=: same-second kept, DB dedupes)
        const detail = await get<{ messages?: { data?: Message[] } } & GraphError>("conversation messages", `${conv.id}?fields=messages{id,from,to,message,created_time}`, opts.signal);
        const msgs = detail.messages?.data ?? [];
        const other =
          (conv.participants?.data ?? []).find((p) => p.id && p.id !== cfg.igUserId) ??
          msgs.map((m) => (m.from?.id !== cfg.igUserId ? m.from : m.to?.data?.find((u) => u.id !== cfg.igUserId))).find((u) => u?.id);
        if (!other?.id) continue;
        const messages: DmMessage[] = msgs
          .map((m): DmMessage => ({ id: m.id, dir: m.from?.id === cfg.igUserId ? "out" : "in", text: m.message ?? "", at: toIso(m.created_time) }))
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); // oldest first (the API lists newest first)
        threads.push({ platformThreadId: conv.id, participantId: other.id, ...(other.username ? { handle: other.username } : {}), messages });
        if (!newest || Date.parse(updated) > Date.parse(newest)) newest = updated;
      }
      return { threads, cursor: newest ? { since: newest } : {} };
    },
  };
}
