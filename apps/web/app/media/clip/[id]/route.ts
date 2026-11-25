// GET /app/media/clip/<mediaId>: a clip's clean mp4 for the library preview, streamed same-origin with Range
// support (R2 is never exposed). Session-guarded.
import { requireSession } from "../../../../lib/auth/require.js";
import { getPool } from "../../../../lib/db.js";
import { serveClip } from "../../../../lib/media/clip.js";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await requireSession();
  const { id } = await ctx.params;
  return serveClip({ pool: getPool(), mediaId: id, mediaBase: process.env.PUBLIC_MEDIA_BASE, range: req.headers.get("range") });
}
