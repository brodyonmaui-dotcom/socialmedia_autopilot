import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { PgBatchStore } from "../../lib/batches/pg-store.js";
import { weekLabel } from "../../lib/batches/view-model.js";
import { batchStatusBadge, countsMeta, needsYouCount, weekIndex } from "../../lib/batches/card-view.js";
import { AppFrame } from "../../components/AppFrame.js";
import { Badge, CONTAINER, EmptyState, RevealList, SectionHead, TopBar, cx, type RevealItem } from "../../components/ui/index.js";
import { Notice } from "./ui/Notice.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Batches · runmysocials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Row = Awaited<ReturnType<PgBatchStore["listBatches"]>>[number];

function toItem(b: Row, now: Date): RevealItem {
  const status = batchStatusBadge(b.status);
  const stuck = needsYouCount(b.counts);
  return {
    id: b.id,
    index: weekIndex(b.weekStart),
    title: weekLabel(b.weekStart, now),
    meta: countsMeta(b.counts).toUpperCase(),
    href: `/batches/${b.id}`,
    trailing: (
      <span className="flex flex-wrap items-center justify-end gap-2">
        {stuck > 0 ? <Badge tone="danger">{stuck} need you</Badge> : null}
        <Badge tone={status.tone}>{status.label}</Badge>
      </span>
    ),
  };
}

export default async function BatchesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error.slice(0, 200) : undefined;
  const batches = await new PgBatchStore(getPool()).listBatches(30);

  const now = new Date();
  // Upcoming = this week's Monday or later (calendar dates compare as strings).
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const thisWeek = monday.toISOString().slice(0, 10);
  const upcoming = batches.filter((b) => b.weekStart >= thisWeek);
  const earlier = batches.filter((b) => b.weekStart < thisWeek);
  const drafts = batches.filter((b) => b.status === "draft").length;

  return (
    <AppFrame active="batches">
      <TopBar index="02" title="Weekly" serif="batches" meta={`${batches.length} weeks · ${drafts} to review`} />
      <Notice error={error} />
      {batches.length === 0 ? (
        <div className={cx(CONTAINER, "py-10")}>
          <EmptyState icon="batches" title="No batches yet" body="Draft one with the weekly-batch skill in a Claude Code session." className="border border-ds-line" />
        </div>
      ) : (
        <>
          {upcoming.length > 0 ? (
            <>
              <SectionHead index="01" title="This &" serif="next" meta={`${upcoming.length} week${upcoming.length === 1 ? "" : "s"}`} />
              <div className={cx(CONTAINER, "-mt-px pb-10")}>
                <RevealList label="This week and next" items={upcoming.map((b) => toItem(b, now))} />
              </div>
            </>
          ) : null}
          {earlier.length > 0 ? (
            <>
              <SectionHead index={upcoming.length > 0 ? "02" : "01"} title="Earlier" serif="weeks" meta={`${earlier.length} week${earlier.length === 1 ? "" : "s"}`} />
              <div className={cx(CONTAINER, "-mt-px pb-10")}>
                <RevealList label="Earlier weeks" items={earlier.map((b) => toItem(b, now))} />
              </div>
            </>
          ) : null}
        </>
      )}
    </AppFrame>
  );
}
