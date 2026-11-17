// Poster frame proxy core (server only). The route file is a thin wrapper (requireSession + env) so
// this stays testable with an injected fetch / file reader. Same rules as the handoff media proxy:
// never logs or returns PUBLIC_MEDIA_BASE, the poster key or upstream bodies; never redirects to R2.
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Pool } from "pg";
import { underBase } from "../handoff/media.js";

export interface ServePosterInput {
  pool: Pick<Pool, "query">;
  mediaId: string;
  /** PUBLIC_MEDIA_BASE. */
  mediaBase: string | undefined;
  /**
   * DEV_POSTER_DIR (absolute): local screenshots only. Honoured only for `demo/` keys (seeded synthetic
   * posters), so it can never serve a real clip's poster from disk.
   */
  devPosterDir?: string;
  fetchImpl?: typeof fetch;
  readFileImpl?: (path: string) => Promise<Uint8Array>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = "private, no-store";
const CACHE = "private, max-age=86400";
const DEMO_PREFIX = "demo/";

const plain = (status: number, body: string): Response =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": NO_STORE } });

const jpegHeaders = (): Headers => new Headers({ "Content-Type": "image/jpeg", "Cache-Control": CACHE, "X-Content-Type-Options": "nosniff" });

/** `<dir>/<key>` only when dir is absolute, the key is a demo key, and the resolved path stays inside dir; else null. */
export function devPosterPath(dir: string, key: string): string | null {
  if (!isAbsolute(dir) || !key.startsWith(DEMO_PREFIX)) return null;
  const root = resolve(dir);
  const target = resolve(root, key);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.startsWith(`demo${sep}`) ? target : null; // still under <dir>/demo/
}

export async function servePoster(i: ServePosterInput): Promise<Response> {
  if (!UUID.test(i.mediaId)) return plain(404, "not found");
  const { rows } = await i.pool.query(`select poster_key from media where id = $1`, [i.mediaId]);
  const key = rows[0]?.poster_key as string | null | undefined;
  if (!key) return plain(404, "not found");

  if (i.devPosterDir && key.startsWith(DEMO_PREFIX)) {
    const path = devPosterPath(i.devPosterDir, key);
    if (!path) {
      console.error("poster: dev key outside the dev poster dir, refused");
      return plain(404, "not found");
    }
    try {
      const bytes = await (i.readFileImpl ?? readFile)(path);
      const headers = jpegHeaders();
      headers.set("Content-Length", String(bytes.byteLength));
      return new Response(bytes as BodyInit, { status: 200, headers });
    } catch {
      return plain(404, "not found");
    }
  }

  if (!i.mediaBase) return plain(503, "media not configured");
  const target = underBase(i.mediaBase, key);
  if (!target) {
    console.error("poster: key outside the media base, refused");
    return plain(404, "not found");
  }

  let upstream: Response;
  try {
    upstream = await (i.fetchImpl ?? fetch)(target, { cache: "no-store" });
  } catch {
    console.error("poster: upstream fetch failed");
    return plain(502, "upstream error");
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => {});
    if (upstream.status === 404) return plain(404, "not found");
    console.error(`poster: upstream status ${upstream.status}`);
    return plain(502, "upstream error");
  }

  const headers = jpegHeaders();
  const len = upstream.headers.get("content-length");
  if (len && /^\d+$/.test(len)) headers.set("Content-Length", len);
  return new Response(upstream.body, { status: 200, headers });
}
