import { InboxScreen, type InboxSearchParams } from "../../components/inbox/InboxScreen.js";
import { requireSession } from "../../lib/auth/require.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox · My Socials" };

/** v3 Inbox, comments. Filters: ?filter=needs-you|drafted|sent|ignored (the legacy ?tab= still works). */
export default async function InboxPage({ searchParams }: { searchParams: Promise<InboxSearchParams> }) {
  await requireSession();
  return <InboxScreen kind="comments" sp={await searchParams} />;
}
