import Link from "next/link";
import { AppFrame } from "../components/AppFrame.js";
import { loadFrameCounts } from "../components/frame-counts.js";
import {
  Avatar,
  BarChart,
  Button,
  ButtonLink,
  Card,
  CardLink,
  DataList,
  DataRow,
  Dropdown,
  EmptyState,
  InlineNotice,
  PageHeader,
  PLATFORM_NAME,
  PlatformLogo,
  StatTile,
  cx,
  type ChartSeries,
  type IconName,
  type StatTint,
} from "../components/ui/index.js";
import { PostCard } from "../components/calendar/index.js";
import { sendManualAction } from "./inbox/actions.js";
import { requireSession } from "../lib/auth/require.js";
import { getPool } from "../lib/db.js";
import { loadEditorEntries } from "../lib/calendar/load.js";
import { listInbox, relativeTime } from "../lib/engagement/queries.js";
import { handoffContext, listHandoff } from "../lib/handoff/store.js";
import {
  activityBars,
  buildKpis,
  DEFAULT_RANGE,
  hasActivity,
  kpiText,
  loadCaptionsDue,
  loadHome,
  parseMetric,
  parseRange,
  periodsFor,
  RANGES,
  rangeText,
  replyTiles,
  weekSchedule,
  type Kpi,
  type MetricId,
  type RangeId,
} from "../lib/home/dashboard.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home · My Socials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);

const KPI_ICON: Record<Kpi["id"], IconName> = { followers: "users", views: "eye", engagement: "heart", posts: "send" };
const SERIES: ChartSeries[] = (["instagram", "youtube", "tiktok", "snapchat"] as const).map((p) => ({ id: p, label: PLATFORM_NAME[p], platform: p }));

function homeHref(range: RangeId, metric: MetricId): string {
  const q = new URLSearchParams();
  if (range !== DEFAULT_RANGE) q.set("range", range);
  if (metric !== "views") q.set("metric", metric);
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

/** v3 Home: KPI tiles, Activity + This week, From your editors + Needs a reply, and the captions / Snapchat strips when relevant. */
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const metric = parseMetric(sp.metric);
  const pool = getPool();
  const now = new Date();
  const zone = handoffContext().timeZone;
  const tz = zone ?? "UTC";

  const [counts, home, editors, flagged, snapToday, captions] = await Promise.all([
    loadFrameCounts(pool),
    loadHome(pool, now, tz, range),
    loadEditorEntries(pool, now),
    listInbox(pool, "flagged", 4),
    // Snapchat "today" needs the creator zone; without it there is no strip (never guess "today").
    zone ? listHandoff(pool, now, zone, handoffContext().blocklist).then((h) => h.today.length) : Promise.resolve(0),
    // F14: drafts for next week (weekly-draft job, editors) still without text; captions come from the weekly-batch skill.
    loadCaptionsDue(pool, now, tz),
  ]);

  const periods = periodsFor(range, home.today);
  const kpis = buildKpis(home, periods, range, home.followers);
  const bars = activityBars(home, periods.current, metric, home.today);
  const week = weekSchedule(home.scheduled, home.today);
  const weekMax = Math.max(1, ...week.map((d) => d.count));
  const weekTotal = week.reduce((s, d) => s + d.count, 0);
  const replies = replyTiles(flagged);
  const days = periods.current.days;
  const rangeLabel = RANGES.find((r) => r.id === range)!.label;
  const error = param(sp.error);
  const note = param(sp.note);

  return (
    <AppFrame active="home" counts={counts}>
      <PageHeader
        title="Home"
        subtitle={rangeText(days[0]!, days[days.length - 1]!)}
        action={<Dropdown label="Range" options={RANGES.map((r) => ({ label: r.label, href: homeHref(r.id, metric), current: r.id === range }))} />}
      />

      {error ? (
        <InlineNotice tone="danger" live className="mb-3 lg:mb-4">
          {error}
        </InlineNotice>
      ) : note ? (
        <InlineNotice live className="mb-3 lg:mb-4">
          {note}
        </InlineNotice>
      ) : null}

      {captions ? (
        <InlineNotice tone="warn" className="mb-3 lg:mb-4" href={captions.href} linkLabel="Open week">
          {captions.text}
        </InlineNotice>
      ) : null}

      <section aria-label={`${rangeLabel} in numbers`} className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {kpis.map((k, i) => (
          <StatTile key={k.id} icon={KPI_ICON[k.id]} label={k.label} value={kpiText(k.value)} delta={k.delta} note={k.note} tint={(i + 1) as StatTint} />
        ))}
      </section>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:mt-4 lg:grid-cols-12 lg:gap-4">
        <Card
          title="Activity"
          titleId="activity"
          subtitle={metric === "views" ? "Views gained per day, every post" : "Likes, comments and shares, by the day a post went out"}
          className="lg:col-span-8"
          action={
            <Dropdown
              label="Chart metric"
              size="sm"
              options={[
                { label: "Views", href: homeHref(range, "views"), current: metric === "views" },
                { label: "Engagement", href: homeHref(range, "engagement"), current: metric === "engagement" },
              ]}
            />
          }
        >
          {hasActivity(bars) ? (
            <BarChart data={bars} series={SERIES} label={`${metric === "views" ? "Views" : "Engagement"} per day, by platform`} unit={metric === "views" ? "views" : "interactions"} height={200} />
          ) : (
            <EmptyState
              icon="analytics"
              title="No numbers yet"
              body="Views show up a day after a post goes out."
              action={
                <ButtonLink href="/calendar" variant="outline" size="sm">
                  Open the calendar
                </ButtonLink>
              }
              className="flex-1 justify-center py-2"
            />
          )}
        </Card>

        <Card title="This week" titleId="this-week" subtitle={weekTotal === 1 ? "1 post planned" : `${weekTotal} posts planned`} className="lg:col-span-4" action={<CardLink href="/calendar">Calendar</CardLink>}>
          <ol className="flex flex-1 flex-col justify-between gap-0.5">
            {week.map((d) => (
              <li key={d.day}>
                <Link
                  href={d.href}
                  aria-label={`${d.weekday} ${d.dayNum}: ${d.count === 1 ? "1 post" : `${d.count} posts`}${d.needsYou ? `, ${d.needsYou} need you` : ""}${d.isToday ? " (today)" : ""}`}
                  aria-current={d.isToday ? "date" : undefined}
                  className={cx(
                    "flex min-h-11 items-center gap-3 rounded-ds-sm px-2 hover:bg-ds-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-focus lg:min-h-9",
                    d.isToday && "bg-ds-raised",
                  )}
                >
                  <span className={cx("w-16 shrink-0 text-[14px]", d.isToday ? "font-bold text-ds-text" : d.isPast ? "text-ds-muted" : "text-ds-text")}>
                    {d.weekday} <span className="ds-num">{d.dayNum}</span>
                  </span>
                  <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-ds-line/60" aria-hidden="true">
                    <span className={cx("absolute inset-y-0 left-0 rounded-full", d.isPast ? "bg-ds-line-strong" : "bg-ds-accent")} style={{ width: `${(d.count / weekMax) * 100}%` }} />
                  </span>
                  <span className="ds-num w-5 shrink-0 text-right text-[14px] font-semibold text-ds-text">{d.count}</span>
                  <span aria-hidden="true" className={cx("size-1.5 shrink-0 rounded-full", d.needsYou ? "bg-ds-warn" : "bg-transparent")} />
                </Link>
              </li>
            ))}
          </ol>
          {week.some((d) => d.needsYou) ? (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-ds-muted">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-ds-warn" />
              Drafts or posts to check
            </p>
          ) : null}
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:mt-4 lg:grid-cols-12 lg:gap-4">
        <Card
          title="From your editors"
          titleId="editors"
          subtitle={editors.total ? `${editors.total === 1 ? "1 clip" : `${editors.total} clips`} waiting for your OK` : undefined}
          className="lg:col-span-6"
          action={editors.total ? <CardLink href="/calendar?status=draft">See all</CardLink> : undefined}
        >
          {editors.total === 0 ? (
            <EmptyState
              icon="film"
              title="Nothing to review"
              body="New edits land here for a quick OK before they're scheduled."
              action={
                <ButtonLink href="/library" variant="outline" size="sm">
                  Open the library
                </ButtonLink>
              }
              className="flex-1 justify-center py-2"
            />
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Edits waiting for approval">
              {editors.entries.map((e) => (
                <li key={e.key}>
                  <PostCard entry={e} back="/" actions="approve" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Needs a reply"
          titleId="replies"
          subtitle={replies.length ? `${counts.flagged === 1 ? "1 comment" : `${counts.flagged ?? replies.length} comments`} flagged for you` : undefined}
          className="lg:col-span-6"
          action={replies.length ? <CardLink href="/inbox">Inbox</CardLink> : undefined}
        >
          {replies.length === 0 ? (
            <EmptyState
              icon="message"
              title="No one is waiting"
              body="Comments that need your own words show up here with a drafted reply."
              action={
                <ButtonLink href="/inbox" variant="outline" size="sm">
                  Open the inbox
                </ButtonLink>
              }
              className="flex-1 justify-center py-2"
            />
          ) : (
            <DataList label="Comments waiting for a reply">
              {replies.map((r) => (
                <DataRow
                  key={r.commentId}
                  leading={<Avatar name={r.who} />}
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      {r.who}
                      <PlatformLogo platform={r.platform} size={14} title={PLATFORM_NAME[r.platform]} className="text-ds-muted" />
                    </span>
                  }
                  meta={relativeTime(r.commentedAt, now)}
                >
                  <p className="line-clamp-2 text-[15px] leading-snug text-ds-text">{r.text}</p>
                  {r.draft ? (
                    <p className="line-clamp-2 rounded-ds-sm bg-ds-raised px-3 py-2 text-[14px] leading-snug text-ds-muted">
                      <span className="sr-only">Drafted reply: </span>
                      {r.draft}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {r.draft ? (
                      <form action={sendManualAction.bind(null, r.commentId, "reply")}>
                        <Button type="submit" variant="outline" size="sm">
                          Approve &amp; send
                        </Button>
                      </form>
                    ) : null}
                    <ButtonLink href={r.href} variant="ghost" size="sm">
                      Open
                    </ButtonLink>
                  </div>
                </DataRow>
              ))}
            </DataList>
          )}
        </Card>
      </div>

      {snapToday > 0 ? (
        <InlineNotice className="mt-3 lg:mt-4" href="/platforms/snapchat" linkLabel="Open">
          Snapchat: today&rsquo;s Spotlight is ready.
        </InlineNotice>
      ) : null}
    </AppFrame>
  );
}
