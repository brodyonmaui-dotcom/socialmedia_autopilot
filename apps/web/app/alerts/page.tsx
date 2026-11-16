import { redirect } from "next/navigation";
import { requireSession } from "../../lib/auth/require.js";

/**
 * v2 route: alerts now live at /notifications (ui-system.md "Screens"). Push notifications still open
 * /app/alerts (worker ALERT_PUSH_URL, sw.js), so this keeps the filter query and redirects.
 */
export default async function AlertsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") sp.set(k, v);
  const q = sp.toString();
  redirect(q ? `/notifications?${q}` : "/notifications");
}
