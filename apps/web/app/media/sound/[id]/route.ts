// GET /app/media/sound/<soundId>: a sound's audio for the Studio preview, streamed same-origin with Range
// support (same proxy as the clip route; R2 is never exposed). Session-guarded.
import { requireSession } from "../../../../lib/auth/require.js";
import { getPool } from "../../../../lib/db.js";
import { serveClip } from "../../../../lib/media/clip.js";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await requireSession();
  const { id } = await ctx.params;
  const pool = getPool();
  // serveClip looks a key up by id; point it at the sounds table instead of media.
  const soundPool = { query: (_sql: string, params?: unknown[]) => pool.query(`select r2_key from sounds where id = $1 and archived_at is null`, params) } as typeof pool;
  return serveClip({ pool: soundPool, mediaId: id, mediaBase: process.env.PUBLIC_MEDIA_BASE, range: req.headers.get("range") });
}
