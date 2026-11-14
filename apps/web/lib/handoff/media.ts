// F10 same-origin media proxy core (server only). The route file is a thin wrapper so this stays testable
// with an injected fetch. Never logs or returns PUBLIC_MEDIA_BASE, the r2 key or upstream bodies.
import type { Pool } from "pg";
import { loadShareable } from "./store.js";

export interface ProxyMediaInput {
  pool: Pool;
  itemId: string;
  now: Date;
  /** Creator zone; null → 503 (never guess "today"). */
  timeZone: string | null;
  /** PUBLIC_MEDIA_BASE; missing → 503. */
  mediaBase: string | undefined;
  fetchImpl?: typeof fetch;
}

const NO_STORE = "private, no-store";
const plain = (status: number, body: string): Response =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": NO_STORE } });

/** `${base}/${key}` only if it still resolves under the base (same origin, base path + "/", no query/fragment); else null. */
function underBase(base: string, key: string): string | null {
  try {
    const b = new URL(base);
    const t = new URL(`${base}/${key}`);
    const prefix = `${b.pathname.replace(/\/+$/, "")}/`;
    if (t.origin !== b.origin || !t.pathname.startsWith(prefix) || t.pathname === prefix || t.search || t.hash) return null;
    return `${base}/${key}`;
  } catch {
    return null;
  }
}

export async function proxyMedia(i: ProxyMediaInput): Promise<Response> {
  if (!i.mediaBase) return plain(503, "media not configured");
  if (!i.timeZone) return plain(503, "TZ_CREATOR not set");
  const item = await loadShareable(i.pool, i.itemId, i.now, i.timeZone);
  if (!item) return plain(404, "not found");
  // Same URL shape as the worker (outbox.ts): base + "/" + r2_key, but never outside the base.
  const target = underBase(i.mediaBase, item.r2Key);
  if (!target) {
    console.error("handoff media: r2 key outside the media base, refused");
    return plain(404, "not found");
  }

  let upstream: Response;
  try {
    upstream = await (i.fetchImpl ?? fetch)(target, { cache: "no-store" });
  } catch {
    console.error("handoff media: upstream fetch failed");
    return plain(502, "upstream error");
  }
  if (!upstream.ok || !upstream.body) {
    console.error(`handoff media: upstream status ${upstream.status}`);
    await upstream.body?.cancel().catch(() => {});
    return plain(502, "upstream error");
  }

  const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": NO_STORE, "X-Content-Type-Options": "nosniff" });
  const len = upstream.headers.get("content-length");
  if (len && /^\d+$/.test(len)) headers.set("Content-Length", len);
  return new Response(upstream.body, { status: 200, headers });
}
