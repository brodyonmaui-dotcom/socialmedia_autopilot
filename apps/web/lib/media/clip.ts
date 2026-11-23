// Clip video proxy core (server only): the clean (metadata-stripped) mp4 streamed same-origin with HTTP Range
// support (iOS Safari needs 206 + Content-Range to play). Same rules as the poster proxy: never logs or returns
// PUBLIC_MEDIA_BASE, the r2 key or upstream bodies; never redirects to R2.
import type { Pool } from "pg";
import { underBase } from "../handoff/media.js";

export interface ServeClipInput {
  pool: Pick<Pool, "query">;
  mediaId: string;
  mediaBase: string | undefined;
  /** The request's Range header, if any. */
  range?: string | null;
  fetchImpl?: typeof fetch;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = "private, no-store";
/** `bytes=0-`, `bytes=100-200`, `bytes=-500`; anything else (multi-range, junk) is dropped and the whole file is sent. */
const RANGE = /^bytes=(\d*)-(\d*)$/;

const plain = (status: number, body: string): Response =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": NO_STORE } });

export const cleanRange = (raw: string | null | undefined): string | null => {
  const m = raw ? RANGE.exec(raw.trim()) : null;
  return m && (m[1] || m[2]) ? `bytes=${m[1]}-${m[2]}` : null;
};

export async function serveClip(i: ServeClipInput): Promise<Response> {
  if (!UUID.test(i.mediaId)) return plain(404, "not found");
  const { rows } = await i.pool.query(`select r2_key from media where id = $1`, [i.mediaId]);
  const key = rows[0]?.r2_key as string | null | undefined;
  if (!key) return plain(404, "not found");
  if (!i.mediaBase) return plain(503, "media not configured");
  const target = underBase(i.mediaBase, key);
  if (!target) {
    console.error("clip: key outside the media base, refused");
    return plain(404, "not found");
  }
  const range = cleanRange(i.range);
  let upstream: Response;
  try {
    upstream = await (i.fetchImpl ?? fetch)(target, { cache: "no-store", ...(range ? { headers: { Range: range } } : {}) });
  } catch {
    console.error("clip: upstream fetch failed");
    return plain(502, "upstream error");
  }
  if (upstream.status === 416) {
    await upstream.body?.cancel().catch(() => {});
    const h = new Headers({ "Cache-Control": NO_STORE });
    const cr = upstream.headers.get("content-range");
    if (cr) h.set("Content-Range", cr);
    return new Response(null, { status: 416, headers: h });
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => {});
    if (upstream.status === 404) return plain(404, "not found");
    console.error(`clip: upstream status ${upstream.status}`);
    return plain(502, "upstream error");
  }
  const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": NO_STORE, "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" });
  const len = upstream.headers.get("content-length");
  if (len && /^\d+$/.test(len)) headers.set("Content-Length", len);
  // Only a 206 carries a Content-Range; a 200 (upstream ignored Range) goes out as a plain 200 with the whole file.
  if (upstream.status === 206) {
    const cr = upstream.headers.get("content-range");
    if (!cr) {
      await upstream.body.cancel().catch(() => {});
      return plain(502, "upstream error");
    }
    headers.set("Content-Range", cr);
  }
  return new Response(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
}
