import { buildWeeklyReport, fmtInt, fmtPct, loadPostRecords, syntheticPosts, type PostRecord } from "@autopilot/analytics";
import { firstLine } from "@autopilot/research";
import { AppFrame } from "../../components/AppFrame.js";
import {
  AreaChart,
  Badge,
  ButtonLink,
  Card,
  Chip,
  CONTAINER,
  Display,
  Donut,
  EmptyState,
  Icon,
  ListRow,
  ListRows,
  PlatformLogo,
  Readout,
  SectionHead,
  Statement,
  StatTile,
  cx,
} from "../../components/ui/index.js";
import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";
import {
  VERDICT,
  compact,
  heroLines,
  lastCompleteWeek,
  overallWeekOverWeek,
  platformName,
  platformShare,
  plural,
  rangeLabel,
  recRows,
  shiftWeek,
  times,
  topInsight,
  trialMeta,
  weekTotals,
  weeklyViews,
} from "../../lib/analytics/view.js";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Bordered cells with collapsed 1px edges (same as Home's numbers band). */
const CELLS = "grid grid-cols-4 lg:grid-cols-12 pl-px pt-px";
const CELL = "-ml-px -mt-px";

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const weekParam = typeof sp.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : undefined;
  const week = weekParam ?? lastCompleteWeek(new Date());
  const demo = sp.demo === "1";

  let posts: PostRecord[];
  if (demo) posts = syntheticPosts({ weekStart: week });
  else posts = await loadPostRecords(getPool(), new Date(Date.parse(week + "T00:00:00Z") - 28 * 86_400_000));

  const r = buildWeeklyReport(posts, { weekStart: week, timeZone: process.env.TZ_CREATOR || "UTC", now: new Date() });
  const q = (w: string) => `/analytics?week=${w}${demo ? "&demo=1" : ""}`;

  const totals = weekTotals(posts, r.weekStart);
  const wow = overallWeekOverWeek(r);
  const series = weeklyViews(posts, r.weekStart);
  const share = platformShare(r);
  const insight = topInsight(r.recommendations);
  const recs = recRows(r.recommendations);
  const trials = r.trials.recommendations;
  const empty = r.platforms.length === 0;

  return (
    <AppFrame active="analytics">
      {/* 01 · Hero */}
      <section aria-label="Weekly report" className="border-b border-ds-line">
        <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
          <div className="col-span-4 flex min-w-0 flex-col gap-8 py-10 lg:col-span-7 lg:gap-10 lg:py-16 lg:pr-10">
            <div className="flex items-center justify-between gap-4">
              <span className="ds-caps text-ds-muted">Weekly report</span>
              <span className="ds-mono text-ds-faint">01 / ANALYTICS</span>
            </div>
            <Display lines={heroLines(r.weekStart, totals.views)} />
            <p className="ds-caps -mt-4 text-ds-muted lg:-mt-6">Views this week · latest snapshot</p>
          </div>
          <div className="col-span-4 flex min-w-0 flex-col justify-between gap-8 border-t border-ds-line py-10 lg:col-span-5 lg:border-l lg:border-t-0 lg:py-16 lg:pl-10">
            {demo && (
              <Chip tone="warn" wrap>
                Demo: invented numbers, not your account.
              </Chip>
            )}
            <Readout
              items={[
                { k: "Week", v: rangeLabel(r.weekStart, r.weekEnd) },
                { k: "Posts", v: String(totals.posts) },
                { k: "Wk / wk", v: times(wow) },
                { k: "Compared over", v: "28 days" },
              ]}
            />
            <nav aria-label="Report week" className="flex flex-wrap items-center gap-3">
              <ButtonLink href={q(shiftWeek(week, -7))} variant="outline" size="sm">
                <Icon name="chevronLeft" size={16} />
                Prev week
              </ButtonLink>
              <ButtonLink href={q(shiftWeek(week, 7))} variant="outline" size="sm">
                Next week
                <Icon name="chevronRight" size={16} />
              </ButtonLink>
              {demo ? (
                <ButtonLink href={`/analytics?week=${week}`} variant="ghost" size="sm">
                  Real data
                </ButtonLink>
              ) : (
                empty && (
                  <ButtonLink href={q(week) + "&demo=1"} variant="ghost" size="sm">
                    See a demo
                  </ButtonLink>
                )
              )}
            </nav>
          </div>
        </div>
      </section>

      {/* 02 · Numbers */}
      <SectionHead index="02" title="By the" serif="numbers" meta={plural(totals.posts, "post") + " this week"} id="numbers" />
      <div className={cx(CONTAINER, "py-10 lg:py-16")}>
        <div className={CELLS}>
          <Card index="A" className={cx(CELL, "col-span-2 lg:col-span-3")}>
            <StatTile icon="eye" value={compact(totals.views)} caption="Views" />
          </Card>
          <Card index="B" className={cx(CELL, "col-span-2 lg:col-span-3")}>
            <StatTile icon="heart" value={compact(totals.likes)} caption="Likes" tone="neutral" />
          </Card>
          <Card index="C" className={cx(CELL, "col-span-2 lg:col-span-3")}>
            <StatTile icon="message" value={compact(totals.comments)} caption="Comments" tone="neutral" />
          </Card>
          <Card index="D" className={cx(CELL, "col-span-2 lg:col-span-3")}>
            <StatTile icon="share" value={compact(totals.shares)} caption="Shares" tone="neutral" />
          </Card>
          <Card
            index="E"
            title={`Views · last ${plural(series.length, "week")}`}
            className={cx(CELL, "col-span-4 lg:col-span-8")}
            bleed={
              <AreaChart
                values={series.map((s) => s.views)}
                xLabels={series.map((s) => s.label)}
                height={180}
                zeroBased
                label={`Views per posting week: ${series.map((s) => `${s.label} ${fmtInt(s.views)}`).join(", ")}`}
              />
            }
          >
            <ul aria-label="Views per week" className="ds-mono flex flex-wrap gap-x-6 gap-y-1 text-ds-faint">
              {series.map((s) => (
                <li key={s.weekStart}>
                  {s.label} · <span className="ds-num text-ds-text">{compact(s.views)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card index="F" title="Posts by platform" className={cx(CELL, "col-span-4 lg:col-span-4")}>
            {share.length > 0 ? (
              <Donut
                segments={share.map((s) => ({ label: `${s.label} · ${s.pct}%`, value: s.value, tone: s.tone }))}
                centerValue={String(totals.posts)}
                centerLabel="Posts"
                label="Posts this week by platform"
              />
            ) : (
              <p className="ds-note">No posts this week.</p>
            )}
            <p className="ds-note mt-5">Posts, not views: a view means something different on each platform.</p>
          </Card>
        </div>
      </div>

      {/* Top insight */}
      <Statement
        text={insight ? insight.text : "Nothing stands out yet."}
        source={insight ? insight.source : "Top insight · needs 6+ posts per platform in 28 days"}
      />

      {/* 03 · Per platform */}
      <SectionHead index="03" title="Per" serif="platform" meta={`${r.weekStart} week · top 3 by views`} />
      <div className={cx(CONTAINER, "py-10 lg:py-16")}>
        {empty ? (
          <EmptyState
            icon="analytics"
            title="No published posts this week"
            body="Posts show up here once they're published and the worker has taken a snapshot."
            action={
              !demo ? (
                <ButtonLink href={q(week) + "&demo=1"} variant="outline" size="sm">
                  See a demo
                </ButtonLink>
              ) : undefined
            }
            className="border border-ds-line py-16"
          />
        ) : (
          <div className={CELLS}>
            {r.platforms.map((p) => (
              <Card
                key={p.platform}
                title={platformName(p.platform)}
                action={<PlatformLogo platform={p.platform} size={22} title={platformName(p.platform)} />}
                className={cx(CELL, "col-span-4 lg:col-span-4")}
              >
                <StatTile icon="eye" value={compact(p.views)} caption="Views" tone="neutral" />
                <Readout
                  className="mt-6"
                  items={[
                    { k: "Measured", v: `${p.withMetrics} of ${plural(p.posts, "post")}` },
                    { k: "Wk / wk", v: times(p.weekOverWeek) },
                  ]}
                />
                <ListRows label={`Top ${platformName(p.platform)} posts`} className="mt-6 border-t border-ds-line">
                  {p.top.map((t, i) => (
                    <ListRow
                      key={t.batchItemId}
                      avatar={{ monogram: String(i + 1).padStart(2, "0"), tone: i === 0 ? "accent" : "neutral" }}
                      title={t.hook || "Untitled"}
                      subtitle={`ER ${fmtPct(t.er)}`}
                      trailing={compact(t.views)}
                      trailingSub="views"
                    />
                  ))}
                </ListRows>
                {p.top.length === 0 && <p className="ds-note mt-4">No metrics yet.</p>}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 04 · What worked */}
      <SectionHead index="04" title="What" serif="worked" meta="Last 28 days · n = posts" />
      <div className={cx(CONTAINER, "grid grid-cols-4 py-10 lg:grid-cols-12 lg:py-16")}>
        <div className="col-span-4 lg:col-span-8">
          {recs.length > 0 ? (
            <ListRows label="Recommendations" className="border-y border-ds-line">
              {recs.map((rec) => (
                <ListRow
                  key={rec.key}
                  avatar={{ platform: rec.platform }}
                  title={rec.title}
                  subtitle={rec.meta}
                  trailing={
                    <span className={cx("inline-flex items-center gap-1", rec.direction === "up" ? "text-ds-accent-fg" : "text-ds-warn")}>
                      <Icon name={rec.direction === "up" ? "chevronUp" : "chevronDown"} size={16} />
                      {rec.lift}
                    </span>
                  }
                  trailingSub={rec.action}
                />
              ))}
            </ListRows>
          ) : (
            <p className="ds-note border-y border-ds-line py-6">Nothing stands out yet.</p>
          )}
        </div>
        <div className="col-span-4 mt-8 flex flex-col gap-4 lg:col-span-3 lg:col-start-10 lg:mt-0">
          <p className="ds-caps text-ds-muted">How to read it</p>
          <p className="ds-note">
            Lift = the group&apos;s median views ÷ your median on that platform. n = posts in the group. Correlations, not causes.
          </p>
          {r.tooEarly.length > 0 && (
            <p className="ds-note">Too early to tell on {r.tooEarly.map(platformName).join(", ")}.</p>
          )}
        </div>
      </div>

      {/* 05 · Trial reels */}
      <SectionHead index="05" title="Trial" serif="reels" meta={`Baseline n=${r.trials.baselineN} regular reels`} />
      <div className={cx(CONTAINER, "grid grid-cols-4 py-10 lg:grid-cols-12 lg:py-16")}>
        <div className="col-span-4 lg:col-span-8">
          {trials.length > 0 ? (
            <ul aria-label="Trial reel recommendations" className="divide-y divide-ds-line border-y border-ds-line">
              {trials.map((t) => (
                <li key={t.batchItemId} className="flex flex-col gap-2 py-4">
                  <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center text-ds-text">
                      <PlatformLogo platform="instagram" size={26} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[16px] font-medium">{firstLine(t.caption) || "Untitled"}</span>
                      <span className="ds-mono mt-0.5 truncate text-ds-faint">{trialMeta(t)}</span>
                    </span>
                    <Badge tone={VERDICT[t.verdict].tone}>{VERDICT[t.verdict].label}</Badge>
                  </div>
                  <p className="ds-note pl-[52px]">{t.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ds-note border-y border-ds-line py-6">No unshared trial reels.</p>
          )}
        </div>
        <div className="col-span-4 mt-8 flex flex-col gap-4 lg:col-span-3 lg:col-start-10 lg:mt-0">
          <p className="ds-caps text-ds-muted">Manual step</p>
          <p className="ds-note">You share these yourself in the Instagram app. Nothing here posts.</p>
        </div>
      </div>

      {r.dataGaps.length > 0 && (
        <>
          <SectionHead index="06" title="Data" serif="gaps" meta={plural(r.dataGaps.length, "note")} />
          <div className={cx(CONTAINER, "py-10 lg:py-16")}>
            <ul aria-label="Data gaps" className="flex flex-col gap-3">
              {r.dataGaps.map((g) => (
                <li key={g}>
                  <Chip tone="warn" wrap>
                    {g}
                  </Chip>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </AppFrame>
  );
}
