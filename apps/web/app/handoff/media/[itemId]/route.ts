// GET /app/handoff/media/<itemId>: the clean file for a due Snapchat item, streamed same-origin so the
// phone can turn it into a File for the share sheet (no R2 CORS change). Session-guarded.
import { requireSession } from "../../../../lib/auth/require.js";
import { getPool } from "../../../../lib/db.js";
import { proxyMedia } from "../../../../lib/handoff/media.js";
import { handoffContext } from "../../../../lib/handoff/store.js";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ itemId: string }> }): Promise<Response> {
  await requireSession();
  const { itemId } = await ctx.params;
  const { timeZone } = handoffContext();
  return proxyMedia({ pool: getPool(), itemId, now: new Date(), timeZone, mediaBase: process.env.PUBLIC_MEDIA_BASE });
}
