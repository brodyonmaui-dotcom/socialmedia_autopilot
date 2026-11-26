// POST /app/media/upload/<uploadId>/abort: cancel before processing → 200 { status: "aborted" }. Session-guarded.
import { requireSession } from "../../../../../lib/auth/require.js";
import { getPool } from "../../../../../lib/db.js";
import { uploadStorage } from "../../../../../lib/uploads/env.js";
import { handleAbort } from "../../../../../lib/uploads/http.js";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await requireSession();
  const { id } = await ctx.params;
  return handleAbort({ db: getPool(), storage: uploadStorage() }, id);
}
