import { requireSession } from "../../lib/auth/require.js";
import { getTheme } from "../../components/ui/theme-server.js";
import {
  AlertCard,
  AppShell,
  AreaChart,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardGrid,
  Checkbox,
  Chip,
  ConfirmSheet,
  Donut,
  EmptyState,
  Icon,
  Input,
  ListRow,
  ListRows,
  MiniBars,
  MonthCalendar,
  PageDots,
  PasswordInput,
  PlatformLogo,
  PLATFORM_NAME,
  ThemeToggle,
  parseTheme,
  type Platform,
  ProgressBar,
  Radio,
  SearchField,
  Select,
  Slider,
  Sparkline,
  StatPair,
  StatTile,
  Stepper,
  TabLinks,
  Tabs,
  Toggle,
  Tooltip,
  TopBar,
} from "../../components/ui/index.js";
import * as F from "./fixtures.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Design system · runmysocials" };

type View = "home" | "batch" | "components";
const VIEWS: Array<{ id: View; label: string }> = [
  { id: "home", label: "Home" },
  { id: "batch", label: "Batch" },
  { id: "components", label: "UI kit" },
];

export default async function DesignPage({ searchParams }: { searchParams: Promise<{ view?: string; theme?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const view: View = VIEWS.some((v) => v.id === sp.view) ? (sp.view as View) : "home";
  // ?theme= overrides the cookie (handy for screenshots); otherwise the viewer's saved choice.
  const theme = sp.theme ? parseTheme(sp.theme) : await getTheme();
  const navActive = view === "home" ? "home" : view === "batch" ? "batches" : "more";

  return (
    <AppShell theme={theme} nav={F.NAV} active={navActive} accounts={F.ACCOUNTS} primaryAction={{ href: "/design?view=batch", label: "New batch" }}>
      <TopBar
        title={view === "home" ? "Overview" : view === "batch" ? "This week" : "Components"}
        subtitle="Design system v1 · demo data"
        action={{ href: "/design?view=batch", label: "New batch", icon: "plus" }}
        search={{ href: "/design?view=components" }}
        extra={<ThemeToggle initial={theme} />}
      />
      <div className="mb-5 lg:max-w-md">
        <TabLinks
          ariaLabel="Style guide sections"
          items={VIEWS.map((v) => ({ href: `/design?view=${v.id}`, label: v.label, active: v.id === view }))}
        />
      </div>
      {view === "home" && <HomeProposed />}
      {view === "batch" && <BatchProposed />}
      {view === "components" && <Components theme={theme} />}
    </AppShell>
  );
}

/* ---------- Home (proposed) ---------- */

function HomeProposed() {
  const w = F.WEEK;
  return (
    <CardGrid>
      <Card
        hero={
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="ds-caps font-bold opacity-80">{w.label} · approved</h2>
              <div className="ds-num mt-1 text-[44px] leading-none tracking-[-0.02em]">
                {w.approved}
                <span className="text-[24px] opacity-70">/{w.total}</span>
              </div>
            </div>
            <Icon name="batches" size={28} className="mb-1 opacity-70" />
          </div>
        }
      >
        <ProgressBar value={w.approved} max={w.total} label="Batch approval" />
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip>
            <span className="ds-num">{w.pending}</span>&nbsp;pending
          </Chip>
          <Chip tone="warn">
            <span className="ds-num">{w.warnings}</span>&nbsp;warnings
          </Chip>
        </div>
        <div className="mt-5">
          <ButtonLink href="/design?view=batch" block>
            Review &amp; approve
          </ButtonLink>
        </div>
      </Card>

      <Card title="Next posts today" action={{ href: "/design?view=batch", label: "See schedule" }}>
        <ListRows label="Next posts today" className="-my-1">
          {F.NEXT_POSTS.map((p) => (
            <ListRow
              key={p.title}
              avatar={{ platform: p.platform }}
              title={p.title}
              subtitle={p.subtitle}
              trailing={p.time}
              trailingSub={p.sub}
            />
          ))}
        </ListRows>
      </Card>

      <Card title="Views · 14 days" bleed={<AreaChart values={F.VIEWS_14D} height={110} label="Daily views, last 14 days, rising" />}>
        <div className="flex items-baseline gap-3">
          <span className="ds-num text-[44px] leading-none tracking-[-0.02em]">{F.VIEWS_TOTAL}</span>
          <Badge tone="accent">{F.VIEWS_DELTA}</Badge>
        </div>
        <p className="mt-1 text-[15px] text-ds-muted">across all four platforms</p>
      </Card>

      <Card title="Alerts" action={{ href: "/design?view=components", label: "All alerts" }}>
        <StatPair>
          <StatTile icon="bell" value={F.ALERTS.open} caption="open alerts" tone="warn" />
          <StatTile icon="check" value={14} caption="posted this week" tone="accent" />
        </StatPair>
        <p className="mt-4 rounded-ds-md bg-ds-raised px-4 py-3 text-[15px] leading-snug text-ds-muted">
          <span className="font-bold text-ds-text">Latest · </span>
          {F.ALERTS.latest}
        </p>
      </Card>

      <Card title="Inbox" action={{ href: "/design?view=components", label: "Open inbox" }}>
        <StatPair>
          <StatTile icon="message" value={F.INBOX.flagged} caption="flagged for you" tone="accent" />
          <StatTile icon="send" value={F.INBOX.autoReplied} caption="auto-replied" />
        </StatPair>
        <div className="mt-5 border-t border-ds-line pt-4">
          <div className="mb-2 flex items-baseline justify-between text-[15px] text-ds-muted">
            <span>Comments per day</span>
            <span className="ds-num text-ds-text">31 today</span>
          </div>
          <MiniBars values={[12, 18, 15, 22, 19, 27, 31]} labels={F.DAY_LABELS} highlightIndex={6} height={44} label="Comments per day this week" />
        </div>
      </Card>

      <Card title="Posting calendar" action={{ href: "/design?view=batch", label: "Plan week" }}>
        <MonthCalendar year={F.CALENDAR.year} month0={F.CALENDAR.month0} today={F.CALENDAR.today} marks={F.CALENDAR.marks} label="November 2026" />
        <div className="mt-3 flex gap-4 text-[13px] text-ds-muted">
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-ds-accent" />scheduled</span>
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-ds-warn" />needs you</span>
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-ds-faint" />posted</span>
        </div>
      </Card>

      <Card title="Share of views" span={1}>
        <Donut segments={F.PER_PLATFORM} centerValue="41%" centerLabel="Instagram" label="Share of views by platform" />
      </Card>
    </CardGrid>
  );
}

/* ---------- Batch card (proposed) ---------- */

function BatchProposed() {
  const p = F.BATCH_POST;
  return (
    <CardGrid>
      <Card as="div" className="overflow-hidden">
        <div className="flex gap-4">
          <div
            aria-hidden="true"
            className="relative flex aspect-[9/16] w-[92px] shrink-0 items-center justify-center rounded-ds-md bg-gradient-to-b from-ds-raised to-ds-line"
          >
            <Icon name="play" size={22} className="text-ds-muted" />
            <span className="ds-num absolute bottom-1.5 right-1.5 rounded bg-ds-frame/80 px-1.5 text-[13px] text-ds-text">{p.duration}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="ds-caps font-bold text-ds-faint">{p.day}</span>
              <span className="ds-num text-[17px] text-ds-text">{p.time}</span>
            </div>
            <h3 className="mt-1 text-[18px] font-bold leading-snug">{p.title}</h3>
            <p className="mt-1 line-clamp-3 text-[15px] leading-snug text-ds-muted">{p.caption}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {p.platforms.map((pl) => (
            <Chip key={pl}>
              <PlatformLogo platform={pl} size={16} />
              {PLATFORM_NAME[pl]}
            </Chip>
          ))}
          <Chip>
            <span className="ds-num">{p.hashtags}</span>&nbsp;hashtags
          </Chip>
        </div>
        <div className="mt-3">
          <Chip tone="warn">{p.warning}</Chip>
        </div>
        <div className="mt-5 grid grid-cols-[1fr_auto_auto] gap-2">
          <Button>Approve</Button>
          <Button variant="outline">Edit</Button>
          <Button variant="icon" aria-label="Reject post" tone="danger">
            <Icon name="x" />
          </Button>
        </div>
      </Card>

      <Card title="Approval">
        <ProgressBar value={18} max={24} label="Approved" showLabel />
        <p className="mt-4 text-[15px] text-ds-muted">
          Approving all schedules the remaining <span className="ds-num text-ds-text">6</span> posts. Nothing publishes until its slot.
        </p>
        <div className="mt-5">
          <ConfirmSheet
            triggerLabel="Approve all 6"
            triggerVariant="solid"
            triggerClassName="w-full"
            title="Approve 6 posts?"
            body="They go into the outbox for their scheduled slots. You can still unapprove any post until it publishes."
            confirmLabel="Approve 6"
          />
        </div>
      </Card>
    </CardGrid>
  );
}

/* ---------- Component gallery ---------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card title={title}>
      <div className="flex flex-col gap-4">{children}</div>
    </Card>
  );
}

function Components({ theme }: { theme: "dark" | "light" }) {
  return (
    <CardGrid>
      <Section title="Buttons">
        <Button block>Approve batch</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline">Edit</Button>
          <Button variant="white">Share</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="outline" tone="danger">Reject</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="icon" aria-label="Search"><Icon name="search" /></Button>
          <Button variant="icon" aria-label="Settings"><Icon name="settings" /></Button>
          <Button size="sm">Small button</Button>
          <Button size="sm" disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Platform logos">
        <p className="text-[15px] text-ds-muted">One colour, the text colour. No brand colours, no circles.</p>
        <div className="flex items-center justify-between px-1 text-ds-text">
          {(["instagram", "youtube", "tiktok", "snapchat"] as Platform[]).map((pl) => (
            <span key={pl} className="flex flex-col items-center gap-2">
              <PlatformLogo platform={pl} size={30} title={PLATFORM_NAME[pl]} />
              <span className="text-[13px] text-ds-muted">{PLATFORM_NAME[pl]}</span>
            </span>
          ))}
        </div>
      </Section>

      <Section title="Appearance">
        <ThemeToggle initial={theme} variant="row" />
      </Section>

      <Section title="Toggles">
        <Toggle label="Auto-reply to comments" defaultChecked description="Routine replies in your voice" />
        <Toggle label="Kill switch" variant="icon" />
        <Toggle label="Weekly report email" variant="text" defaultChecked />
        <Toggle label="Disabled setting" disabled />
      </Section>

      <Section title="Choices">
        <div>
          <Checkbox label="Instagram" defaultChecked name="pf" value="ig" />
          <Checkbox label="YouTube Shorts" defaultChecked name="pf" value="yt" />
          <Checkbox label="TikTok" name="pf" value="tt" description="Goes as an inbox draft" />
        </div>
        <div role="radiogroup" aria-label="Reply mode">
          <Radio label="Shadow (draft only)" name="mode" value="shadow" defaultChecked />
          <Radio label="Live replies" name="mode" value="live" />
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs
          ariaLabel="Inbox views"
          defaultValue="flagged"
          items={[
            { id: "flagged", label: "Flagged", count: 7 },
            { id: "shadow", label: "Shadow", count: 3 },
            { id: "sent", label: "Sent" },
          ]}
        />
        <PageDots count={4} active={1} label="Clip preview" />
      </Section>

      <Section title="Badges & chips">
        <div className="flex flex-wrap gap-2">
          <Badge>Draft</Badge>
          <Badge tone="accent">Approved</Badge>
          <Badge tone="solid">Live</Badge>
          <Badge tone="warn">Needs sound</Badge>
          <Badge tone="danger">Failed</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip>Reel</Chip>
          <Chip tone="accent">Scheduled 9:00</Chip>
          <Chip tone="warn">6 hashtags · max 5</Chip>
        </div>
      </Section>

      <Section title="Inputs">
        <SearchField label="Search clips" name="q" placeholder="Search clips" />
        <Input label="Caption hook" name="hook" placeholder="Three minutes, no equipment…" helper="Keep it under 60 characters." />
        <PasswordInput label="Password" name="pw" defaultValue="demo-value" helper="Example only." />
        <Input label="Title" name="t" defaultValue="Way too long title" error="YouTube titles max out at 100 characters." />
      </Section>

      <Section title="Select & stepper">
        <Select label="Pillar" name="pillar" defaultValue="move">
          <option value="move">Movement</option>
          <option value="food">Food</option>
          <option value="desk">Desk & tools</option>
        </Select>
        <Stepper label="Posts per day" name="ppd" defaultValue={3} min={1} max={6} />
      </Section>

      <Section title="Progress & slider">
        <ProgressBar value={62} label="Upload" showLabel />
        <ProgressBar value={1} max={1} label="Spotlight today" showLabel valueText="1 of 1 used" />
        <Slider label="Reply delay (min)" defaultValue={12} min={0} max={60} />
      </Section>

      <Card title="Alerts" span={2}>
        <div className="grid gap-4 sm:grid-cols-2">
          <AlertCard title="Attention" action={<Button size="sm">Review</Button>}>
            Instagram token expires in 6 days. Reconnect to keep posting.
          </AlertCard>
          <AlertCard tone="light" title="Attention" action={<Button size="sm">Small button</Button>}>
            TikTok draft needs a sound before it can go out.
          </AlertCard>
        </div>
      </Card>

      <Section title="Rows & stats">
        <ListRows label="Accounts">
          <ListRow avatar={{ platform: "instagram" }} title="Instagram" subtitle="Graph API · direct" trailing="3" trailingSub="today" href="/design?view=home" />
          <ListRow avatar={{ platform: "snapchat" }} title="Snapchat" subtitle="Assisted · tap to share" trailing="1" trailingSub="to share" />
        </ListRows>
        <StatPair>
          <StatTile icon="eye" value="8.7k" caption="views yesterday" tone="accent" />
          <StatTile icon="heart" value="612" caption="likes yesterday" />
        </StatPair>
      </Section>

      <Section title="Charts">
        <div className="flex items-center justify-between">
          <span className="text-[15px] text-ds-muted">Followers, 7 days</span>
          <Sparkline values={[3, 4, 3.5, 5, 4.8, 6, 6.4]} label="Followers trend, rising" />
        </div>
        <MiniBars values={F.POSTS_PER_DAY} labels={F.DAY_LABELS} highlightIndex={5} label="Posts per day" />
      </Section>

      <Section title="Empty, tooltip, sheet">
        <EmptyState icon="inbox" title="Inbox zero" body="New comments that need you will show up here." />
        <div className="flex items-center gap-3">
          <Tooltip id="tip-cap" text="One Spotlight per day">
            <Button variant="icon" aria-label="Spotlight limit" aria-describedby="tip-cap"><Icon name="clock" /></Button>
          </Tooltip>
          <ConfirmSheet
            triggerLabel="Open sheet"
            title="Pause auto-replies?"
            body="Replies stop right away. Comments keep arriving in your inbox."
            confirmLabel="Pause"
          />
        </div>
      </Section>
    </CardGrid>
  );
}
