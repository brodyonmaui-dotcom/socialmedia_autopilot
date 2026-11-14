import { notFound } from "next/navigation";
import { AppFrame } from "../../../components/AppFrame.js";
import { Badge, ButtonLink, CONTAINER, Card, Chip, Icon, ProgressBar, Readout, cx } from "../../../components/ui/index.js";
import { getPool } from "../../../lib/db.js";
import { requireSession } from "../../../lib/auth/require.js";
import { approvalProgress, batchStatusBadge, needsYouCount, weekIndex } from "../../../lib/batches/card-view.js";
import { loadWarningContext } from "../../../lib/batches/context.js";
import { PgBatchStore } from "../../../lib/batches/pg-store.js";
import { planTransition } from "../../../lib/batches/transitions.js";
import { confirmCounts, weekLabel, groupByLocalDay, summaryCounts } from "../../../lib/batches/view-model.js";
import { computeWarnings } from "../../../lib/batches/warnings.js";
import { ApproveBar } from "../ui/ApproveBar.js";
import { CELL, CELLS } from "../ui/nav.js";
import { Notice } from "../ui/Notice.js";
import { EditorSection } from "../../../components/editor/EditorCard.js";
import { rendersOfBatch } from "../../../lib/editor/queries.js";
import { RejectedList, WeekGrid } from "../ui/WeekGrid.js";
import { addItemAction, approveAllAction, fillTimesAction } from "./actions.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Batch · runmysocials" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);
const two = (n: number) => String(n).padStart(2, "0");

export default async function BatchPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireSession();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;

  const pool = getPool();
  const store = new PgBatchStore(pool);
  const batch = await store.loadBatch(id);
  if (!batch) notFound();

  const [ctx, media] = await Promise.all([
    loadWarningContext({ pool, weekStart: batch.weekStart, batchId: batch.id }),
    store.listLibraryMedia(60),
  ]);
  const ws = computeWarnings(batch.items, ctx);
  for (const i of batch.items) i.warnings = ws.get(i.id) ?? [];

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
  const progress = approvalProgress(batch.counts);
  const stuck = needsYouCount(batch.counts);
  const status = batchStatusBadge(batch.status);
  const openReset = param(sp.reset);
  const editorRenders = rendersOfBatch(batch, now, ctx.timeZone);

  return (
    <AppFrame active="batches">
      <header className="border-b border-ds-line">
        <div className={cx(CONTAINER, "grid grid-cols-4 gap-y-4 py-8 lg:grid-cols-12 lg:py-12")}>
          <div className="col-span-4 flex items-center justify-between gap-3 lg:col-span-12">
            <ButtonLink href="/batches" variant="ghost" className="-ml-4">
              <Icon name="chevronLeft" size={16} />
              All batches
            </ButtonLink>
            <span className="flex flex-wrap items-center justify-end gap-2">
              {stuck > 0 ? <Badge tone="danger">{stuck} need you</Badge> : null}
              <Badge tone={status.tone}>{status.label}</Badge>
            </span>
          </div>
          <p className="ds-mono col-span-1 text-ds-muted lg:self-end">{weekIndex(batch.weekStart)} /</p>
          <h1 className="col-span-3 text-[40px] font-black leading-[0.95] tracking-[-0.04em] lg:col-span-11 lg:text-[72px]">
            Week of <span className="ds-serif font-normal">{weekLabel(batch.weekStart, now)}</span>
          </h1>
        </div>
      </header>

      <Notice error={param(sp.error)} note={param(sp.note)} />

      <EditorSection renders={editorRenders} index="01" from="batch" utcFallback={ctx.timeZoneSource === "fallback"} />

      <div className="border-b border-ds-line">
        <div className={cx(CONTAINER, "py-6 lg:py-10")}>
          <div className={CELLS}>
            <Card index="A" title="Approval" className={cx(CELL, "col-span-4 lg:col-span-7")}>
              <div className="flex items-baseline gap-2">
                <span className="ds-num text-[64px] font-black leading-none tracking-[-0.05em]">{progress.done}</span>
                <span className="ds-serif text-[32px] text-ds-muted">of {progress.total}</span>
              </div>
              <div className="mt-6">
                <ProgressBar value={progress.done} max={progress.total} label="Approved or later" showLabel />
              </div>
              <Readout
                className="mt-6"
                items={[
                  { k: "Draft", v: two(c.draft) },
                  { k: "Approved", v: two(c.approved) },
                  { k: "Published", v: two(c.published) },
                  { k: "Rejected", v: two(c.rejected) },
                  ...(c.other ? [{ k: "Other", v: two(c.other) }] : []),
                ]}
              />
              {ctx.timeZoneSource === "fallback" ? (
                <p className="mt-6 flex">
                  <Chip wrap tone="warn">
                    Times shown in UTC: set TZ_CREATOR
                  </Chip>
                </p>
              ) : null}
            </Card>
            <Card index="B" title="Actions" className={cx(CELL, "col-span-4 lg:col-span-5")}>
              <p className="mb-6 text-[15px] leading-snug text-ds-muted">
                {confirm.approvable > 0
                  ? `${confirm.approvable} draft${confirm.approvable === 1 ? "" : "s"} ready · ${skipped.length} blocked · ${confirm.warnCount} warning${confirm.warnCount === 1 ? "" : "s"}`
                  : "No drafts ready to approve."}
              </p>
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
            </Card>
          </div>
        </div>
      </div>

      <WeekGrid groups={groups} timeZone={ctx.timeZone} openReset={openReset} />
      <RejectedList items={rejected} timeZone={ctx.timeZone} />
    </AppFrame>
  );
}
