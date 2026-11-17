import { redirect } from "next/navigation";
import { requireSession } from "../../lib/auth/require.js";

/** /platforms has no page of its own: the sidebar group opens on Instagram. */
export default async function PlatformsIndex() {
  await requireSession();
  redirect("/platforms/instagram");
}
