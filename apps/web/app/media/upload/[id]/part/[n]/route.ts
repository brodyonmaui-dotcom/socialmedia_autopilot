// PUT /app/media/upload/<uploadId>/part/<n>: raw bytes of part n (1-based, ≤ 8 MiB) → 200 { etag }. Session-guarded.
import { requireSession } from "../../../../../../lib/auth/require.js";
import { getPool } from "../../../../../../lib/db.js";
import { uploadStorage } from "../../../../../../lib/uploads/env.js";
import { handlePart } from "../../../../../../lib/uploads/http.js";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string; n: string }> }): Promise<Response> {
  await requireSession();
  const { id, n } = await ctx.params;
  return handlePart({ db: getPool(), storage: uploadStorage() }, id, n, req);
}
