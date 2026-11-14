import { AppFrame, MoreList } from "../../components/AppFrame.js";
import { moreLinks } from "../../components/app-nav.js";
import { loadFrameCounts } from "../../components/frame-counts.js";
import { CONTAINER, SectionHead } from "../../components/ui/index.js";
import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "More · runmysocials" };

/** The More tab: the secondary destinations (same list as the header menu), alerts badge included. */
export default async function MorePage() {
  await requireSession();
  const counts = await loadFrameCounts(getPool());
  return (
    <AppFrame active="more" counts={counts}>
      <SectionHead index="05" title="Everything" serif="else" meta="Alerts, Snapchat, library, research" />
      <div className={CONTAINER}>
        <div className="grid grid-cols-4 lg:grid-cols-12">
          <div className="col-span-4 py-4 lg:col-span-6 lg:py-8">
            <MoreList links={moreLinks(counts)} />
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
