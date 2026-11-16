import { redirect } from "next/navigation";
import { requireSession } from "../../lib/auth/require.js";

/** v2 "More" tab: gone in v3 (everything is in the sidebar). Redirects to Settings. */
export default async function MorePage() {
  await requireSession();
  redirect("/settings");
}
