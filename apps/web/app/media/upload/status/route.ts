// GET /app/media/upload/status?ids=a,b → 200 [{ id, status, mediaId?, posterUrl?, error? }] for exactly those uploads. Session-guarded.
import { requireSession } from "../../../../lib/auth/require.js";
import { getPool } from "../../../../lib/db.js";
import { handleStatus } from "../../../../lib/uploads/http.js";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  await requireSession();
  return handleStatus({ db: getPool() }, req.url);
}
