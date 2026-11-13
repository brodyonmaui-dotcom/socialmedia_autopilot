import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "../../../lib/db.js";
import { requireSession } from "../../../lib/auth/require.js";
import { loadWarningContext } from "../../../lib/batches/context.js";
import { PgBatchStore } from "../../../lib/batches/pg-store.js";
import { planTransition } from "../../../lib/batches/transitions.js";
import { confirmCounts, weekLabel, groupByLocalDay, summaryCounts } from "../../../lib/batches/view-model.js";
import { computeWarnings } from "../../../lib/batches/warnings.js";
import { ApproveBar } from "../ui/ApproveBar.js";
import { PostCard } from "../ui/PostCard.js";
import { Banner, StatusPill } from "../ui/WarningChip.js";
import { WeekGrid } from "../ui/WeekGrid.js";
import { addItemAction, approveAllAction, fillTimesAction } from "./actions.js";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);

export default async function BatchPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireSession();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;

  const pool = getPool();
  const store = new PgBatchStore(pool);
  const batch = await store.loadBatch(id);
  if (!batch) notFound();

  const [ctx, media, urlRows] = await Promise.all([
    loadWarningContext({ pool, weekStart: batch.weekStart, batchId: batch.id }),
    store.listLibraryMedia(60),
    pool.query("select id, platform_post_url from batch_items where batch_id = $1 and platform_post_url is not null", [batch.id]),
  ]);
  const ws = computeWarnings(batch.items, ctx);
  for (const i of batch.items) i.warnings = ws.get(i.id) ?? [];
  const urls = new Map<string, string>(urlRows.rows.map((r: { id: string; platform_post_url: string }) => [r.id, r.platform_post_url]));

  const now = new Date();
  const confirm = confirmCounts(batch.items, planTransition(batch, { kind: "approve-all" }, now));
  const byId = new Map(batch.items.map((i) => [i.id, i]));
  const skipped = confirm.skipped.map((s) => {
    const i = byId.get(s.itemId);
    return { ...s, label: i ? `${i.platform} · ${i.media.label}` : s.itemId };
  });

  const live = batch.items.filter((i) => i.status !== "rejected");
  const rejected = batch.items.filter((i) => i.status === "rejected");
  const groups = groupByLocalDay(live, ctx.timeZone, batch.weekStart);
  const untimedDrafts = live.filter((i) => i.status === "draft" && i.scheduledFor == null).length;
  const c = summaryCounts(batch.counts);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-32 text-base">
      <div className="flex items-center justify-between">
        <Link href="/batches" className="inline-flex min-h-11 items-center text-neutral-500 underline">
          all batches
        </Link>
        <StatusPill status={batch.status} />
      </div>
      <h1 className="text-xl font-semibold">Week of {weekLabel(batch.weekStart, now)}</h1>
      <p className="text-sm text-neutral-500">
        {c.draft} draft · {c.approved} approved · {c.published} published · {c.rejected} rejected{c.other ? ` · ${c.other} other` : ""}
      </p>
      {ctx.timeZoneSource === "fallback" ? <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">times shown in UTC: set TZ_CREATOR</p> : null}
      <Banner kind="error" text={param(sp.error)} />
      <Banner kind="note" text={param(sp.note)} />

      <WeekGrid groups={groups} timeZone={ctx.timeZone} urls={urls} />

      {rejected.length > 0 ? (
        <details className="mt-6">
          <summary className="min-h-11 cursor-pointer py-2 text-neutral-500">Rejected ({rejected.length})</summary>
          <ul className="mt-2 space-y-3 opacity-70">
            {rejected.map((item) => (
              <PostCard key={item.id} item={item} time={null} timeZone={ctx.timeZone} postUrl={urls.get(item.id)} />
            ))}
          </ul>
        </details>
      ) : null}

      <ApproveBar
        batchId={batch.id}
        approvable={confirm.approvable}
        warnCount={confirm.warnCount}
        skipped={skipped}
        untimedCount={untimedDrafts}
        media={media}
        approveAll={approveAllAction.bind(null, batch.id)}
        fillTimes={fillTimesAction.bind(null, batch.id)}
        addItem={addItemAction}
      />
    </main>
  );
}
