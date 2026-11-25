import { notFound } from "next/navigation";
import { localClock12, type Platform } from "@autopilot/core";
import { AppFrame } from "../../../components/AppFrame.js";
import { SnapchatShare } from "../../../components/platforms/SnapchatShare.js";
import {
  Badge,
  ButtonLink,
  Card,
  CardLink,
  DataList,
  DataRow,
  EmptyState,
  Icon,
  InlineNotice,
  PageHeader,
  PlatformLogo,
  StatTile,
  Thumb,
  cx,
  type IconName,
} from "../../../components/ui/index.js";
import { requireSession } from "../../../lib/auth/require.js";
import { getPool } from "../../../lib/db.js";
import { handoffContext, listHandoff } from "../../../lib/handoff/store.js";
import type { HandoffItem, HandoffList } from "../../../lib/handoff/types.js";
import { suggestionMeta } from "../../../lib/handoff/view.js";
import { ANALYTICS_DAYS, loadPlatformPage, type PlatformPageData } from "../../../lib/platforms/load.js";
import { snapchatSuggestion } from "../../../lib/platforms/snapchat.js";
import {
  connectionView,
  dayLabel,
  fmtCount,
  fmtRate,
  followerNote,
  parsePlatform,
  PLATFORM_NAME,
  replyView,
  replySendView,
  routeSentence,
  routeWord,
  todayView,
  type Tone,
} from "../../../lib/platforms/view.js";
import { zoneNotice } from "../../../lib/settings/replies.js";

export const dynamic = "force-dynamic";

type Params = Promise<{ platform: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const p = parsePlatform((await params).platform);
  return { title: `${p ? PLATFORM_NAME[p] : "Platform"} · My Socials` };
}

const TONE_TEXT: Record<Tone, string> = { neutral: "text-ds-muted", accent: "text-ds-accent-fg", warn: "text-ds-warn", danger: "text-ds-danger" };
const SHORT_REASON: Partial<Record<Platform, string>> = { tiktok: "Not collected on the free plan", snapchat: "Snapchat has no numbers API" };

/** Status card value: a word in its tone, with an icon when it needs attention (never colour alone). */
function StatusValue({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[14px] font-semibold", TONE_TEXT[tone])}>
      {tone === "warn" || tone === "danger" ? <Icon name="alert" size={16} /> : null}
      {label}
    </span>
  );
}

function StatusCard({ d, className }: { d: PlatformPageData; className?: string }) {
  const p = d.platform;
  const conn = connectionView(p, d.token);
  const reply = replyView(p, d.engagement, d.killEnv);
  const sending = replySendView(p, d.replyStatus);
  const rows: Array<{ icon: IconName; title: string; meta: string; value: string; tone: Tone }> = [
    { icon: "send", title: "How posts go out", meta: p === "snapchat" ? "Share sheet on your phone" : p === "tiktok" ? "Approved partner, holds the clock" : p === "youtube" ? "YouTube holds the clock" : "The server posts at each time", value: routeWord(p), tone: "neutral" },
    { icon: "lock", title: "Connection", meta: conn.detail, value: conn.label, tone: conn.tone },
    { icon: "sliders", title: "Daily limit", meta: "Change it in Settings", value: `${d.cap} a day`, tone: "neutral" },
    { icon: "reply", title: "Replies", meta: reply.detail, value: reply.label, tone: reply.tone },
    ...(sending ? [{ icon: "send" as IconName, title: "Reply sending", meta: sending.detail, value: sending.label, tone: sending.tone }] : []),
  ];
  return (
    <Card title="Status" titleId="status" action={<CardLink href="/settings">Settings</CardLink>} className={className}>
      <DataList label={`${PLATFORM_NAME[p]} status`}>
        {rows.map((r) => (
          <DataRow key={r.title} icon={r.icon} title={r.title} meta={r.meta} wrapMeta trailing={<StatusValue label={r.value} tone={r.tone} />} />
        ))}
      </DataList>
    </Card>
  );
}

function UpcomingCard({ d, className }: { d: PlatformPageData; className?: string }) {
  const name = PLATFORM_NAME[d.platform];
  return (
    <Card
      title="Next posts"
      titleId="next"
      subtitle={d.upcoming.length ? `The next ${d.upcoming.length === 1 ? "post" : `${d.upcoming.length} posts`} on ${name}` : undefined}
      action={d.upcoming.length ? <CardLink href="/calendar">Calendar</CardLink> : undefined}
      className={className}
    >
      {d.upcoming.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={`Nothing scheduled for ${name}`}
          body="Approved posts show up here with their day and time."
          action={
            <ButtonLink href="/calendar" variant="outline" size="sm">
              Open the calendar
            </ButtonLink>
          }
          className="flex-1 justify-center py-2"
        />
      ) : (
        <DataList label={`Next posts on ${name}`}>
          {d.upcoming.map((u) => (
            <DataRow
              key={u.key}
              href={u.href}
              leading={<Thumb mediaId={u.mediaId} alt={`${u.title} poster`} className="w-9" />}
              title={u.title}
              meta={
                <>
                  {u.when}
                  <span className="sm:hidden"> · {u.statusLabel}</span>
                </>
              }
              trailing={
                <span className="hidden sm:inline-flex">
                  <Badge tone={u.tone}>{u.statusLabel}</Badge>
                </span>
              }
            />
          ))}
        </DataList>
      )}
    </Card>
  );
}

function Tiles({ d, sharedToday }: { d: PlatformPageData; sharedToday?: number }) {
  const a = d.analytics;
  const off = a && !a.collected ? (SHORT_REASON[d.platform] ?? "Not collected") : null;
  const today = todayView(sharedToday === undefined ? d.counts : { ...d.counts, sent: sharedToday }, d.cap);
  return (
    <section aria-label={`${PLATFORM_NAME[d.platform]} in numbers`} className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <StatTile icon="send" label={d.platform === "snapchat" ? "Shared today" : "Posted today"} value={today.value} note={today.note} tint={1} />
      <StatTile icon="users" label="Followers" value={off ? null : fmtCount(a?.followers)} note={off ?? followerNote(a?.followersDelta, ANALYTICS_DAYS) ?? "No numbers yet"} tint={2} />
      <StatTile icon="eye" label={`Views, ${ANALYTICS_DAYS} days`} value={off ? null : fmtCount(a?.views)} note={off ?? (a?.views == null ? "No numbers yet" : `${a.posts === 1 ? "1 post" : `${a.posts} posts`} in the range`)} tint={3} />
      <StatTile icon="heart" label="Engagement rate" value={off ? null : fmtRate(a?.engagementRate)} note={off ?? (a?.engagementRate == null ? "No numbers yet" : "Likes, comments, shares and saves per view")} tint={4} />
    </section>
  );
}

async function SnapchatToday({ d, list, zone, now }: { d: PlatformPageData; list: HandoffList | null; zone: string | null; now: Date }) {
  if (!zone || !list) {
    return (
      <Card title="Today’s Spotlight" titleId="today" className="lg:col-span-8">
        <EmptyState
          icon="clock"
          title="Waiting for your time zone"
          body="This page won't guess what “today” is: a wrong day could mean a double share. It's set on the server; see the Snapchat handoff runbook."
          action={
            <ButtonLink href="/calendar" variant="outline" size="sm">
              Open the calendar
            </ButtonLink>
          }
          className="flex-1 justify-center py-2"
        />
      </Card>
    );
  }
  const when = (it: HandoffItem) => `${dayLabel(it.localDay, d.today)} · ${localClock12(new Date(it.scheduledFor), zone)}`;
  if (list.today.length === 0 && list.missed.length === 0) {
    const pick = await snapchatSuggestion(getPool(), now);
    return (
      <Card title="Today’s Spotlight" titleId="today" className="lg:col-span-8">
        <EmptyState
          icon="share"
          title="Nothing to share today"
          body="Approved Snapchat posts show up here on their day. Plan one in the calendar and approve it there."
          action={
            <ButtonLink href="/calendar" variant="outline" size="sm">
              Open the calendar
            </ButtonLink>
          }
          className="justify-center py-2"
        />
        {pick ? (
          <div className="mt-4 border-t border-ds-line pt-4">
            <p className="ds-label text-ds-muted">A clip worth sending</p>
            <DataList label="Suggested clip" className="mt-2">
              <DataRow
                leading={
                  <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-ds-sm bg-ds-raised text-ds-text">
                    <PlatformLogo platform={pick.platform} size={18} />
                  </span>
                }
                title={pick.label}
                meta={suggestionMeta(pick)}
                wrapMeta
              />
            </DataList>
            <p className="mt-3 text-[13px] leading-snug text-ds-muted">The app never adds Snapchat posts on its own: plan it in the calendar if you want it.</p>
          </div>
        ) : null}
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3 lg:col-span-8 lg:gap-4">
      {list.today.map((it) => (
        <Card key={it.id} title={it.label} titleId={`snap-${it.id}`} subtitle="Today’s Spotlight" as="article">
          <SnapchatShare item={it} when={when(it)} />
        </Card>
      ))}
      {list.missed.map((it) => (
        <Card key={it.id} title={it.label} titleId={`snap-${it.id}`} subtitle="Missed: share it, skip it or drop it" as="article">
          <SnapchatShare item={it} when={when(it)} missed />
        </Card>
      ))}
    </div>
  );
}

/**
 * /platforms/[platform] (v3): how posts go out, today against the daily limit, the account numbers, the next
 * five posts and a status list (connection, limit, replies). Snapchat adds the share-sheet handoff (moved from
 * /handoff) with its confirmations. Read-only except the Snapchat actions.
 */
export default async function PlatformPage({ params }: { params: Params }) {
  await requireSession();
  const platform = parsePlatform((await params).platform);
  if (!platform) notFound();
  const pool = getPool();
  const now = new Date();
  const d = await loadPlatformPage(pool, platform, now);
  const name = PLATFORM_NAME[platform];
  const tzNote = d.zoneSet ? null : zoneNotice("fallback");

  const header = (
    <PageHeader
      title={name}
      subtitle={routeSentence(platform)}
      action={
        <ButtonLink href={`/analytics/${platform}`} variant="outline" size="sm">
          Analytics
        </ButtonLink>
      }
      className="[&_p]:max-w-[64ch]"
    />
  );

  if (platform !== "snapchat") {
    return (
      <AppFrame active={`platforms/${platform}`}>
        {header}
        {tzNote ? (
          <InlineNotice tone="warn" className="mb-3 lg:mb-4">
            {tzNote}
          </InlineNotice>
        ) : null}
        <Tiles d={d} />
        <div className="mt-3 grid grid-cols-1 gap-3 lg:mt-4 lg:grid-cols-12 lg:gap-4">
          <UpcomingCard d={d} className="lg:col-span-8" />
          <StatusCard d={d} className="lg:col-span-4" />
        </div>
      </AppFrame>
    );
  }

  // Snapchat: "today" needs the creator zone; without it the handoff never guesses (no UTC fallback here).
  const ctx = handoffContext();
  const list = ctx.timeZone ? await listHandoff(pool, now, ctx.timeZone, ctx.blocklist) : null;
  return (
    <AppFrame active="platforms/snapchat">
      {header}
      {tzNote ? (
        <InlineNotice tone="warn" className="mb-3 lg:mb-4">
          {tzNote}
        </InlineNotice>
      ) : null}
      <Tiles d={d} sharedToday={ctx.timeZone ? d.counts.sent : 0} />
      <div className="mt-3 grid grid-cols-1 gap-3 lg:mt-4 lg:grid-cols-12 lg:gap-4">
        <SnapchatToday d={d} list={list} zone={ctx.timeZone} now={now} />
        <div className="flex flex-col gap-3 lg:col-span-4 lg:gap-4">
          <StatusCard d={d} />
          <UpcomingCard d={d} />
        </div>
      </div>
    </AppFrame>
  );
}
