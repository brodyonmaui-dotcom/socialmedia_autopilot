// GET /app/api/search?q=…: the CommandPalette's grouped results (Pages, Posts, Ideas, Clips). Session-guarded,
// read-only, parameterised SQL only; min 2 characters, max 5 results per group.
import { requireSession } from "../../../lib/auth/require.js";
import { getPool } from "../../../lib/db.js";
import { handoffContext } from "../../../lib/handoff/store.js";
import { searchAll } from "../../../lib/search/query.js";
import { cleanQuery } from "../../../lib/search/shape.js";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  await requireSession();
  const q = cleanQuery(new URL(req.url).searchParams.get("q"));
  const headers = { "cache-control": "no-store" };
  if (!q) return Response.json({ q: "", groups: [] }, { headers });
  try {
    const res = await searchAll(getPool(), q, handoffContext().timeZone ?? "UTC");
    return Response.json(res, { headers });
  } catch (err) {
    console.error(`search failed: ${(err as Error).name}`);
    return Response.json({ q, groups: [], error: "search failed" }, { status: 500, headers });
  }
}
