import { redirect } from "next/navigation";
import { requireSession } from "../../lib/auth/require.js";
import { touchUpRedirect } from "../../lib/library/screen.js";

/** Old route: Touch-up lives under the Library now. The query is kept. */
export default async function TouchUpRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  redirect(touchUpRedirect(await searchParams));
}
