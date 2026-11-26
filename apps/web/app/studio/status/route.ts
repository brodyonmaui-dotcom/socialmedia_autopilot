// GET /app/studio/status?ids=a,b → 200 [{ id, status, resultMediaId?, posterUrl?, error? }] for exactly those Studio
// renders (kind = 'studio' only). Session-guarded.
import { requireSession } from "../../../lib/auth/require.js";
import { getPool } from "../../../lib/db.js";
import { handleStudioStatus } from "../../../lib/studio/data.js";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  await requireSession();
  return handleStudioStatus(getPool(), req.url);
}
