import { CAPABILITIES, type Platform } from "@autopilot/core";
import { AppFrame } from "../components/AppFrame.js";
import {
  ButtonLink,
  Card,
  Chip,
  CONTAINER,
  Display,
  EmptyState,
  FooterBand,
  FramedImage,
  GlassCard,
  ListRow,
  ListRows,
  Marquee,
  MonthCalendar,
  PLATFORM_NAME,
  PlatformLogo,
  ProgressBar,
  Readout,
  RevealList,
  SectionHead,
  Statement,
  StatPair,
  StatTile,
  StatusPulse,
  cx,
} from "../components/ui/index.js";
import { requireSession } from "../lib/auth/require.js";
import { PgBatchStore } from "../lib/batches/pg-store.js";
import { getPool } from "../lib/db.js";
import { loadEditorRenders } from "../lib/editor/queries.js";
import { EditorSection } from "../components/editor/EditorCard.js";
import { Notice } from "./batches/ui/Notice.js";
import { handoffContext, listHandoff } from "../lib/handoff/store.js";
import {
  batchProgress,
  heroLines,
  isoWeek,
  marqueeItems,
  monthMarks,
  nextPostShort,
  plural,
  routeLabel,
  snapLine,
  upNextMeta,
  upNextTitle,
  type LatestBatch,
  type UpNextRow,
} from "../lib/home/view.js";

export const dynamic = "force-dynamic";

/** Bordered cells with collapsed 1px edges (same approach as CardGrid / the /design guide). */
const CELLS = "grid grid-cols-4 lg:grid-cols-12 pl-px pt-px";
const CELL = "-ml-px -mt-px";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const pool = getPool();
  const now = new Date();
  // Read-only, indexed counts. The first three also feed the frame's badges (passed in, not re-queried).
  const [batchRows, alertRows, flaggedRows, latestAlert, outboxRows, upNext, monthRows, latest, editors] = await Promise.all([
    pool.query("select status, count(*)::int as n from batches group by status"),
    pool.query("select count(*)::int as n from alerts where acknowledged_at is null"),
    pool.query("select count(*)::int as n from comment_triage where bucket in ('flag', 'hide_flag') and handled_at is null"),
    pool.query("select message from alerts where acknowledged_at is null order by created_at desc limit 1"),
    pool.query("select count(*)::int as n from batch_items where status in ('failed', 'unknown')"),
    // Up next: approved posts with a time still ahead (count(*) over () = all of them, before the limit).
    pool.query(
      `select bi.id, bi.batch_id, bi.platform, bi.title, bi.caption, bi.scheduled_for, m.duration_s, count(*) over ()::int as total
         from batch_items bi
         join batches b on b.id = bi.batch_id
         join media m on m.id = bi.media_id
        where bi.status in ('approved', 'queued', 'publishing') and b.status = 'approved' and bi.scheduled_for >= $1
        order by bi.scheduled_for asc, bi.created_at asc
        limit 5`,
      [now],
    ),
    // Calendar marks: a window around this month (the creator-local month is cut in monthMarks()).
    pool.query(
      `select scheduled_for, status from batch_items
        where scheduled_for >= $1 and scheduled_for < $2 and status not in ('draft', 'rejected')`,
      [new Date(now.getTime() - 32 * 86_400_000), new Date(now.getTime() + 32 * 86_400_000)],
    ),
    new PgBatchStore(pool).listBatches(1),
    // F15: editor drafts (read-only; warnings computed per whole batch).
    loadEditorRenders(pool, now),
  ]);
  const hasEditors = editors.renders.length > 0;
  const idx = (n: number) => String(hasEditors ? n + 1 : n).padStart(2, "0");
  const flagged = (flaggedRows.rows[0]?.n as number | undefined) ?? 0;
  const batchCount = (s: string) => (batchRows.rows as Array<{ status: string; n: number }>).find((r) => r.status === s)?.n ?? 0;
  const openAlerts = (alertRows.rows[0]?.n as number | undefined) ?? 0;
  const stuck = (outboxRows.rows[0]?.n as number | undefined) ?? 0;
  const latestAlertText = latestAlert.rows[0]?.message as string | undefined;
  const platforms = Object.entries(CAPABILITIES) as Array<[Platform, (typeof CAPABILITIES)[Platform]]>;
  // F10: Snapchat items due today (null when TZ_CREATOR is unset: no guessing "today").
  const snapCtx = handoffContext();
  const snapToday = snapCtx.timeZone ? (await listHandoff(pool, new Date(), snapCtx.timeZone, snapCtx.blocklist)).today.length : null;
  const tz = snapCtx.timeZone;

  const batch: LatestBatch | null = latest[0] ? { id: latest[0].id, weekStart: latest[0].weekStart, status: latest[0].status, counts: latest[0].counts } : null;
  const progress = batch ? batchProgress(batch.counts) : null;
  const week = batch ? isoWeek(batch.weekStart) : null;
  const next: UpNextRow[] = upNext.rows.map((r) => ({
    id: r.id,
    batchId: r.batch_id,
    platform: r.platform as Platform,
    title: r.title,
    caption: r.caption,
    scheduledFor: new Date(r.scheduled_for),
    durationS: r.duration_s == null ? null : Number(r.duration_s),
  }));
  const upcomingTotal = (upNext.rows[0]?.total as number | undefined) ?? 0;
  const cal = monthMarks(
    monthRows.rows.map((r) => ({ scheduledFor: new Date(r.scheduled_for), status: String(r.status) })),
    now,
    tz,
  );
  const first = next[0];
  const footerLink =
    flagged > 0
      ? { href: "/inbox", label: `Inbox — ${flagged} waiting`, sub: "Flagged comments" }
      : snapToday
        ? { href: "/handoff", label: `Snapchat — ${snapToday} today`, sub: "Tap to share" }
        : { href: "/batches", label: "Batches", sub: `${plural(batchCount("draft"), "draft")} · ${batchCount("approved")} approved` };

  return (
    <AppFrame
      active="home"
      counts={{ draftBatches: batchCount("draft"), flagged, openAlerts }}
      footer={<FooterBand link={footerLink} status="Approved posts only" meta="runmysocials · approval first" />}
    >
      {/* 01 · Split hero */}
      <section aria-label="This week" className="border-b border-ds-line">
        <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
          <div className="col-span-4 flex min-w-0 flex-col gap-8 py-10 lg:col-span-7 lg:gap-10 lg:py-16 lg:pr-10">
            <div className="flex items-center justify-between">
              {openAlerts > 0 ? (
                <StatusPulse tone="warn" label={`${plural(openAlerts, "alert")} open`} />
              ) : (
                <StatusPulse label="No open alerts" />
              )}
              <span className="ds-mono text-ds-faint">01 / OVERVIEW</span>
            </div>
            <Display lines={heroLines(batch)} />
            {progress && progress.total > 0 && <ProgressBar value={progress.approved} max={progress.total} label="Batch approval" />}
            <Readout
              items={[
                { k: "Pending", v: progress ? plural(progress.draft, "post") : "—" },
                { k: "Next post", v: nextPostShort(first, tz) },
                { k: "Alerts", v: `${openAlerts} open` },
                { k: "Outbox", v: `${stuck} stuck` },
              ]}
            />
            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink href={batch ? `/batches/${batch.id}` : "/batches"} arrow>
                {batch ? "Review batch" : "Open batches"}
              </ButtonLink>
              {stuck > 0 && (
                <Chip tone="warn">
                  <span className="ds-num">{stuck}</span>&nbsp;failed or unknown
                </Chip>
              )}
            </div>
          </div>
          <div className="col-span-4 min-w-0 pb-10 lg:col-span-5 lg:border-l lg:border-ds-line lg:pb-0">
            <FramedImage alt="Next post preview (placeholder)" ratio="4/5" className="lg:aspect-auto lg:h-full">
              <div className="absolute inset-x-5 bottom-5">
                <GlassCard title="Next up" code={week ? `W${week}` : undefined}>
                  {first ? (
                    <ListRows label="Next scheduled post">
                      <ListRow
                        avatar={{ platform: first.platform }}
                        title={upNextTitle(first.title, first.caption)}
                        subtitle={upNextMeta(first, tz)}
                        href={`/batches/${first.batchId}`}
                      />
                    </ListRows>
                  ) : (
                    <p className="ds-mono text-ds-muted">Nothing scheduled yet</p>
                  )}
                </GlassCard>
              </div>
            </FramedImage>
          </div>
        </div>
      </section>

      <Marquee
        items={marqueeItems(platforms.map(([p]) => p), batch)}
        label={`Instagram, YouTube, TikTok, Snapchat${week ? ` — week ${week}` : ""}`}
      />

      <Notice error={param(sp.error)} note={param(sp.note)} />

      {/* 02 · From your editors (F15; hidden when there are none) */}
      <EditorSection renders={editors.renders} index="02" from="home" hideWhenEmpty utcFallback={editors.timeZoneSource === "fallback"} />

      {/* Up next */}
      <SectionHead index={idx(2)} title="Up" serif="next" meta={<span>{plural(upcomingTotal, "post")} scheduled</span>} />
      <div className={CONTAINER}>
        {next.length > 0 ? (
          <RevealList
            label="Next scheduled posts"
            items={next.map((p, i) => ({
              id: p.id,
              index: String(i + 1).padStart(2, "0"),
              title: upNextTitle(p.title, p.caption),
              meta: upNextMeta(p, tz),
              href: `/batches/${p.batchId}`,
              trailing: <PlatformLogo platform={p.platform} size={28} title={PLATFORM_NAME[p.platform]} />,
              image: { alt: `${upNextTitle(p.title, p.caption)} preview (placeholder)` },
            }))}
          />
        ) : (
          <EmptyState
            icon="calendar"
            title="Nothing scheduled"
            body="Approved posts with a time show up here, soonest first."
            action={
              <ButtonLink href="/batches" variant="outline" size="sm">
                Open batches
              </ButtonLink>
            }
            className="border-b border-ds-line py-16"
          />
        )}
      </div>

      {/* 03 · Numbers */}
      <SectionHead index={idx(3)} title="By the" serif="numbers" meta="Live counts" id="numbers" />
      <div className={cx(CONTAINER, "py-10 lg:py-16")}>
        <div className={CELLS}>
          <Card index="A" title="Batches" className={cx(CELL, "col-span-4 lg:col-span-6")}>
            <StatPair>
              <StatTile icon="batches" value={batchCount("draft")} caption="Draft" tone="neutral" />
              <StatTile icon="check" value={batchCount("approved")} caption="Approved" />
            </StatPair>
            <ButtonLink href="/batches" variant="ghost" size="sm" arrow className="-ml-6 mt-6">
              All batches
            </ButtonLink>
          </Card>
          <Card index="B" title="Flagged" className={cx(CELL, "col-span-2 lg:col-span-3")}>
            <StatTile icon="message" value={flagged} caption="Need you" />
            <ButtonLink href="/inbox" variant="ghost" size="sm" arrow className="-ml-6 mt-6">
              Inbox
            </ButtonLink>
          </Card>
          <Card index="C" title="Alerts" className={cx(CELL, "col-span-2 lg:col-span-3")}>
            <StatTile icon="bell" value={openAlerts} caption="Open" tone={openAlerts ? "warn" : "accent"} />
            {latestAlertText && <p className="ds-note mt-4 line-clamp-3">{latestAlertText}</p>}
            <ButtonLink href="/alerts" variant="ghost" size="sm" arrow className="-ml-6 mt-6">
              Alerts
            </ButtonLink>
          </Card>
          <Card index="D" title="Calendar" className={cx(CELL, "col-span-4 lg:col-span-5")}>
            <MonthCalendar
              year={cal.year}
              month0={cal.month0}
              today={cal.today}
              marks={cal.marks}
              label={`${MONTHS[cal.month0]} ${cal.year}${tz ? "" : " (UTC)"}`}
            />
          </Card>
          <Card index="E" title="Snapchat" className={cx(CELL, "col-span-4 lg:col-span-4")}>
            {snapToday === null ? (
              <div className="flex flex-col items-start gap-4">
                <Chip tone="warn">{snapLine(snapToday)}</Chip>
                <p className="ds-note">Set TZ_CREATOR on the server so &ldquo;today&rdquo; is your day, not a guess.</p>
              </div>
            ) : (
              <StatTile icon="share" value={snapToday} caption="To share today" />
            )}
            <ButtonLink href="/handoff" variant="ghost" size="sm" arrow className="-ml-6 mt-6">
              Handoff
            </ButtonLink>
          </Card>
          <Card index="F" title="Routes" className={cx(CELL, "col-span-4 lg:col-span-3")}>
            <ListRows label="Posting route per platform">
              {platforms.map(([platform, cap]) => (
                <ListRow key={platform} avatar={{ platform }} title={PLATFORM_NAME[platform]} subtitle={routeLabel(cap)} />
              ))}
            </ListRows>
          </Card>
        </div>
      </div>

      <Statement
        text="Nothing goes public until you approve it."
        source={progress ? `Approval boundary · week ${week} · ${progress.approved} of ${progress.total} approved` : "Approval boundary"}
      />

    </AppFrame>
  );
}
