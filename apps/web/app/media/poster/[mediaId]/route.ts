// GET /app/media/poster/<mediaId>: a clip's small poster JPEG, streamed same-origin (R2 is never exposed).
// Session-guarded. DEV_POSTER_DIR (absolute; demo/ keys only) serves the seeded synthetic posters locally.
import { requireSession } from "../../../../lib/auth/require.js";
import { getPool } from "../../../../lib/db.js";
import { servePoster } from "../../../../lib/media/poster.js";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ mediaId: string }> }): Promise<Response> {
  await requireSession();
  const { mediaId } = await ctx.params;
  return servePoster({ pool: getPool(), mediaId, mediaBase: process.env.PUBLIC_MEDIA_BASE, devPosterDir: process.env.DEV_POSTER_DIR || undefined });
}
