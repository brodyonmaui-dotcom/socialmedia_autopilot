import { AppFrame } from "../../components/AppFrame.js";
import { FindingsCard } from "../../components/analytics/FindingsCard.js";
import { PlatformSummary } from "../../components/analytics/PlatformSummary.js";
import { PostRows } from "../../components/analytics/PostRows.js";
import { ButtonLink, Card, Dropdown, EmptyState, LineChart, PageHeader, PlatformLogo, StatTile, type IconName, type StatTint } from "../../components/ui/index.js";
import { requireSession } from "../../lib/auth/require.js";
import { creatorZone } from "../../lib/calendar/load.js";
import { getPool } from "../../lib/db.js";
import { loadOverview, postDay } from "../../lib/analytics/overview.js";
import { analyticsHref, dayAxis, overviewTiles, parseDays, rangeOptions, rangeText, viewsChart, type TileId } from "../../lib/analytics/present.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics · My Socials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TILE_ICON: Record<TileId, IconName> = { followers: "users", views: "eye", engagement: "heart", posts: "send" };
const TOP_SHOWN = 6;

/** v3 Analytics overview: four numbers, views per day by platform, What worked, top posts, then one card per platform. */
export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const days = parseDays(sp.days);
  const { timeZone } = creatorZone();
  const o = await loadOverview(getPool(), { days, timeZone, now: new Date() });

  const tiles = overviewTiles(o);
  const chart = viewsChart(o.viewsPerDay);
  const axis = dayAxis(o.viewsPerDay.map((d) => d.date));
  const top = o.topPosts.slice(0, TOP_SHOWN).map((p) => ({
    id: p.accountPostId,
    platform: p.platform,
    title: p.title,
    permalink: p.permalink,
    mediaId: p.mediaId,
    day: postDay(p, timeZone),
    views: p.views,
    engagementRate: p.engagementRate,
    byHand: p.byHand,
  }));

  return (
    <AppFrame active="analytics">
      <PageHeader
        title="Analytics"
        subtitle={rangeText(o.range.from, o.range.to)}
        action={<Dropdown label="Range" options={rangeOptions(days, (d) => analyticsHref({ days: d }))} />}
      />

      {!o.hasData ? (
        <Card>
          <EmptyState
            icon="analytics"
            title="No numbers yet"
            body="Views, followers and what worked show up here a day after your first posts go out."
            action={<ButtonLink href="/calendar">Open the calendar</ButtonLink>}
          />
        </Card>
      ) : (
        <>
          <section aria-label={`Last ${days} days in numbers`} className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            {tiles.map((t, i) => (
              <StatTile key={t.id} icon={TILE_ICON[t.id]} label={t.label} value={t.value} delta={t.delta} note={t.note} tint={(i + 1) as StatTint} />
            ))}
          </section>

          <Card
            title="Views per day"
            titleId="views-per-day"
            subtitle="Views gained each day, every post, by platform"
            className="mt-3 lg:mt-4"
          >
            {chart.series.length && chart.total > 0 ? (
              <LineChart
                series={chart.series}
                values={chart.values}
                xLabels={axis.labels}
                xTitles={axis.titles}
                labelEvery={axis.labelEvery}
                label="Views per day, by platform"
                unit="views"
                height={200}
              />
            ) : (
              <EmptyState
                icon="eye"
                title="No views in this range"
                body="Views are counted once a day for every post."
                action={
                  <ButtonLink href={analyticsHref({ days: 60 })} variant="outline" size="sm">
                    Show 60 days
                  </ButtonLink>
                }
                className="py-4"
              />
            )}
            {chart.missing.length ? (
              <ul aria-label="Platforms not in the chart" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-ds-line pt-3">
                {chart.missing.map((m) => (
                  <li key={m.platform} className="flex items-center gap-1.5 text-[13px] text-ds-muted">
                    <PlatformLogo platform={m.platform} size={14} className="text-ds-text" />
                    {m.text}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:mt-4 lg:grid-cols-12 lg:gap-4">
            <FindingsCard findings={o.findings} days={o.findingsDays} className="lg:col-span-6" />
            <Card title="Top posts" titleId="top-posts" subtitle={`Most views, posted in the last ${days} days`} className="lg:col-span-6">
              {top.length ? (
                <PostRows posts={top} label="Top posts by views" />
              ) : (
                <EmptyState
                  icon="film"
                  title="Nothing posted in this range"
                  body="Pick a longer range to see earlier posts."
                  action={
                    <ButtonLink href={analyticsHref({ days: 60 })} variant="outline" size="sm">
                      Show 60 days
                    </ButtonLink>
                  }
                  className="py-4"
                />
              )}
            </Card>
          </div>

          <section aria-label="By platform" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:mt-4 lg:grid-cols-4 lg:gap-4">
            {o.platforms.map((c) => (
              <PlatformSummary key={c.platform} card={c} href={analyticsHref({ platform: c.platform, days })} days={days} />
            ))}
          </section>
        </>
      )}
    </AppFrame>
  );
}
