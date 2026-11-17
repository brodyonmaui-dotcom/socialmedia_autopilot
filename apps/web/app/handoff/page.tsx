import { redirect } from "next/navigation";
import { requireSession } from "../../lib/auth/require.js";

/**
 * v2 route: the Snapchat share-sheet handoff now lives on its platform page (ui-system.md "Screens").
 * The actions (./actions.ts) and the same-origin media route (./media/[itemId]) stay at their URLs.
 */
export default async function HandoffRedirect() {
  await requireSession();
  redirect("/platforms/snapchat");
}
