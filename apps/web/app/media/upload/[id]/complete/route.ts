// POST /app/media/upload/<uploadId>/complete: all parts in → 200 { status: "uploaded" }; the worker takes it from there. Session-guarded.
import { requireSession } from "../../../../../lib/auth/require.js";
import { getPool } from "../../../../../lib/db.js";
import { uploadStorage } from "../../../../../lib/uploads/env.js";
import { handleComplete } from "../../../../../lib/uploads/http.js";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await requireSession();
  const { id } = await ctx.params;
  return handleComplete({ db: getPool(), storage: uploadStorage() }, id);
}
