import { notFound } from "next/navigation";
import { loadPostRecords, recommendTrialShares, type TrialRecommendation } from "@autopilot/analytics";
import { firstLine } from "@autopilot/research";
import { AppFrame } from "../../../components/AppFrame.js";
import { BestHours } from "../../../components/analytics/BestHours.js";
import { FindingsCard } from "../../../components/analytics/FindingsCard.js";
import { PostsTable } from "../../../components/analytics/PostsTable.js";
import {
  Badge,
  BarChart,
  ButtonLink,
  Card,
  CardLink,
  DataList,
  DataRow,
  Dropdown,
  EmptyState,
  LineChart,
  PageHeader,
  PlatformLogo,
  StatTile,
  type IconName,
  type StatTint,
} from "../../../components/ui/index.js";
import { requireSession } from "../../../lib/auth/require.js";
import { creatorZone } from "../../../lib/calendar/load.js";
import { getPool } from "../../../lib/db.js";
import { postDay } from "../../../lib/analytics/overview.js";
import { loadPlatform } from "../../../lib/analytics/platform.js";
import {
  PLATFORM_LABEL,
  POSTS_SHOWN,
  VERDICT,
  analyticsHref,
  dayAxis,
  followersChart,
  notCollectedCopy,
  parseDays,
  parsePlatform,
  parseSort,
  platformTiles,
  rangeOptions,
  rangeText,
  sortPosts,
  trialMeta,
  type TileId,
} from "../../../lib/analytics/present.js";

export const dynamic = "force-dynamic";

type Params = Promise<{ platform: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TILE_ICON: Record<TileId, IconName> = { followers: "users", views: "eye", engagement: "heart", posts: "send" };

export async function generateMetadata({ params }: { params: Params }) {
  const p = parsePlatform((await params).platform);
  return { title: `${p ? PLATFORM_LABEL[p] : "Analytics"} · My Socials` };
}

/** Instagram trial reels waiting for a share decision (empty on any error: this block is optional). */
async function loadTrials(now: Date): Promise<TrialRecommendation[]> {
  try {
    const posts = await loadPostRecords(getPool(), new Date(now.getTime() - 28 * 86_400_000));
    return recommendTrialShares(posts, now).recommendations;
  } catch {
    return [];
  }
}

/** v3 platform analytics: followers, views per day, best posting time, findings and the posts table. */
export default async function PlatformAnalyticsPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireSession();
  const platform = parsePlatform((await params).platform);
  if (!platform) notFound();
  const sp = await searchParams;
  const days = parseDays(sp.days);
  const sort = parseSort(sp.sort);
  const { timeZone } = creatorZone();
  const now = new Date();
  const name = PLATFORM_LABEL[platform];
  const [v, trials] = await Promise.all([loadPlatform(getPool(), platform, { days, timeZone, now }), platform === "instagram" ? loadTrials(now) : Promise.resolve([])]);

  const header = (subtitle: string, withRange: boolean) => (
    <PageHeader
      title={name}
      back={{ href: analyticsHref({ days }), label: "Analytics" }}
      subtitle={subtitle}
      action={withRange ? <Dropdown label="Range" options={rangeOptions(days, (d) => analyticsHref({ platform, days: d, sort }))} /> : undefined}
    />
  );

  if (!v.collected) {
    const copy = notCollectedCopy(platform, v.reason);
    return (
      <AppFrame active={`analytics/${platform}`}>
        {header("Numbers aren't collected for this platform", false)}
        <Card title="Why there are no numbers" titleId="why" className="lg:max-w-[50rem]">
          <div className="flex flex-col gap-4">
            <p className="flex items-start gap-3 text-[17px] leading-snug text-ds-text">
              <PlatformLogo platform={platform} size={22} className="mt-0.5 shrink-0" />
              {copy.headline}
            </p>
            <dl className="flex flex-col divide-y divide-ds-line border-t border-ds-line">
              <div className="flex flex-col gap-1 py-3">
                <dt className="ds-label text-ds-muted">What would turn it on</dt>
                <dd className="text-[15px] leading-snug text-ds-text">{copy.turnOn}</dd>
              </div>
              <div className="flex flex-col gap-1 py-3 pb-0">
                <dt className="ds-label text-ds-muted">Until then</dt>
                <dd className="text-[15px] leading-snug text-ds-text">{copy.meanwhile}</dd>
              </div>
            </dl>
            <div>
              <ButtonLink href={`/platforms/${platform}`}>Open the {name} page</ButtonLink>
            </div>
          </div>
        </Card>
      </AppFrame>
    );
  }

  const tiles = platformTiles(v.card, days);
  const axis = dayAxis(v.viewsPerDay.map((d) => d.date));
  const followers = followersChart(v);
  const viewsTotal = v.viewsPerDay.reduce((s, d) => s + d.views, 0);
  const bars = v.viewsPerDay.map((d, i) => ({ label: axis.labels[i]!, title: axis.titles[i], values: { [platform]: d.views }, highlight: i === v.viewsPerDay.length - 1 }));
  const series = [{ id: platform, label: name, platform }];
  const all = sp.all === "1";
  const sorted = sortPosts(v.posts, sort);
  const posts = all ? sorted : sorted.slice(0, POSTS_SHOWN);
  const postDays = Object.fromEntries(v.posts.map((p) => [p.accountPostId, postDay(p, timeZone)]));
  const hasHours = v.bestHours.some((h) => h.n > 0);

  return (
    <AppFrame active={`analytics/${platform}`}>
      {header(rangeText(v.range.from, v.range.to), true)}

      <section aria-label={`${name}, last ${days} days in numbers`} className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {tiles.map((t, i) => (
          <StatTile key={t.id} icon={TILE_ICON[t.id]} label={t.label} value={t.value} delta={t.delta} note={t.note} tint={(i + 1) as StatTint} />
        ))}
      </section>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:mt-4 lg:grid-cols-12 lg:gap-4">
        <Card title="Followers" titleId="followers" subtitle="Follower count at the end of each day" className="lg:col-span-6">
          {followers.known > 0 ? (
            <LineChart
              series={series}
              values={{ [platform]: followers.values }}
              xLabels={axis.labels}
              xTitles={axis.titles}
              labelEvery={axis.labelEvery}
              label={`${name} followers per day`}
              unit="followers"
              baseline="auto"
              legend={false}
              height={180}
            />
          ) : (
            <EmptyState icon="users" title="No follower counts yet" body="They're read once a day; the first one shows up tomorrow." className="py-4" />
          )}
        </Card>
        <Card title="Views per day" titleId="views" subtitle="Views gained each day, every post" className="lg:col-span-6">
          {viewsTotal > 0 ? (
            <BarChart data={bars} series={series} labelEvery={axis.labelEvery} label={`${name} views per day`} unit="views" height={180} />
          ) : (
            <EmptyState icon="eye" title="No views in this range" body="Views are counted once a day for every post." className="py-4" />
          )}
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:mt-4 lg:grid-cols-12 lg:gap-4">
        <FindingsCard findings={v.findings} days={v.findingsDays} showPlatform={false} className="lg:col-span-8" />
        <Card title="Best posting time" titleId="best-time" subtitle={`Median views by hour posted, last ${v.findingsDays} days`} className="lg:col-span-4">
          {hasHours ? (
            <BestHours hours={v.bestHours} />
          ) : (
            <EmptyState icon="clock" title="No posts to compare yet" body="Each time slot needs at least 5 posts with views." className="py-4" />
          )}
        </Card>
      </div>

      <Card
        title="Posts"
        titleId="posts"
        subtitle={v.posts.length === 1 ? "1 post in this range" : `${v.posts.length} posts in this range`}
        className="mt-3 lg:mt-4"
        footer={
          sorted.length > POSTS_SHOWN ? (
            <CardLink href={analyticsHref({ platform, days, sort, all: !all })}>{all ? `Show the first ${POSTS_SHOWN}` : `Show all ${sorted.length} posts`}</CardLink>
          ) : undefined
        }
        action={
          v.posts.length > 1 ? (
            <Dropdown
              label="Sort posts"
              size="sm"
              options={[
                { label: "Newest", href: analyticsHref({ platform, days, all }), current: sort === "date" },
                { label: "Most views", href: analyticsHref({ platform, days, sort: "views", all }), current: sort === "views" },
              ]}
            />
          ) : undefined
        }
      >
        {posts.length ? (
          <PostsTable platform={platform} posts={posts} days={postDays} sort={sort} sortHref={(s) => analyticsHref({ platform, days, sort: s, all })} />
        ) : (
          <EmptyState
            icon="film"
            title="Nothing posted in this range"
            body="Pick a longer range or plan posts in the calendar."
            action={<ButtonLink href="/calendar">Open the calendar</ButtonLink>}
            className="py-4"
          />
        )}
      </Card>

      {platform === "instagram" ? (
        trials.length ? (
          <Card title="Trial reels" titleId="trials" subtitle="Shown to non-followers first. You share them yourself in the Instagram app." className="mt-3 lg:mt-4">
            <DataList label="Trial reels to decide on">
              {trials.map((t) => (
                <DataRow
                  key={t.batchItemId}
                  icon="play"
                  title={firstLine(t.caption) || "Untitled"}
                  meta={trialMeta(t)}
                  trailing={<Badge tone={VERDICT[t.verdict].tone}>{VERDICT[t.verdict].label}</Badge>}
                >
                  <p className="pl-12 text-[14px] leading-snug text-ds-muted">{t.reason}</p>
                </DataRow>
              ))}
            </DataList>
          </Card>
        ) : (
          <p className="mt-4 text-[13px] text-ds-muted">No trial reels waiting for a share decision.</p>
        )
      ) : null}
    </AppFrame>
  );
}
