import { redirect } from "next/navigation";
import { requireSession } from "../../lib/auth/require.js";

/** v2 route: the batch list is now the Calendar. */
export default async function BatchesRedirect() {
  await requireSession();
  redirect("/calendar");
}
