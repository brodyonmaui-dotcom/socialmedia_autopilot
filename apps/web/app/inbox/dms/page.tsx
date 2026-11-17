import { InboxScreen, type InboxSearchParams } from "../../../components/inbox/InboxScreen.js";
import { requireSession } from "../../../lib/auth/require.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "DMs · My Socials" };

/** v3 Inbox, Instagram DMs (read + draft only; he replies in the Instagram app). */
export default async function DmsPage({ searchParams }: { searchParams: Promise<InboxSearchParams> }) {
  await requireSession();
  return <InboxScreen kind="dms" sp={await searchParams} />;
}
