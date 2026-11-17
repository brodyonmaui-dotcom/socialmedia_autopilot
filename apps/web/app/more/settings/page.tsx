import { redirect } from "next/navigation";
import { requireSession } from "../../../lib/auth/require.js";

/** v2 route: Settings moved to /settings (ui-system.md "Screens"). Query (?note / ?error) is kept. */
export default async function OldSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") sp.set(k, v);
  const q = sp.toString();
  redirect(q ? `/settings?${q}` : "/settings");
}
