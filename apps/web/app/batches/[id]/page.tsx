import { redirect } from "next/navigation";
import { requireSession } from "../../../lib/auth/require.js";
import { batchRedirect } from "../../../lib/calendar/model.js";
import { getPool } from "../../../lib/db.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** v2 deep link (alerts, old pushes): `/batches/<id>` → the Calendar's week view of that week. */
export default async function BatchRedirect({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  let weekStart: string | null = null;
  if (UUID.test(id)) {
    const { rows } = await getPool().query("select week_start::text as week_start from batches where id = $1", [id]);
    weekStart = (rows[0]?.week_start as string | undefined) ?? null;
  }
  redirect(batchRedirect(weekStart));
}
