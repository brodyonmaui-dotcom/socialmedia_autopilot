import type { ReactNode } from "react";
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
  Checkbox,
  Chip,
  CONTAINER,
  ConfirmSheet,
  Display,
  Donut,
  EmptyState,
  FooterBand,
  FramedImage,
  GlassCard,
  Icon,
  Input,
  ListRow,
  ListRows,
  Marquee,
  MiniBars,
  MonthCalendar,
  PageDots,
  PasswordInput,
  PlatformLogo,
  PLATFORM_NAME,
  ProgressBar,
  Radio,
  Readout,
  RevealList,
  SearchField,
  SectionHead,
  Select,
  Slider,
  Sparkline,
  Statement,
  StatTile,
  StatusBars,
  StatusPulse,
  Stepper,
  TabLinks,
  Tabs,
  ThemeToggle,
  Toggle,
  Tooltip,
  TopBar,
  cx,
  parseTheme,
  type Platform,
  type Theme,
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

/** Card cells have a full 1px border; overlapping by 1px collapses shared edges (same approach as CardGrid). */
const CELLS = "grid grid-cols-4 lg:grid-cols-12 pl-px pt-px";
const CELL = "-ml-px -mt-px";

export default async function DesignPage({ searchParams }: { searchParams: Promise<{ view?: string; theme?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const view: View = VIEWS.some((v) => v.id === sp.view) ? (sp.view as View) : "home";
  // ?theme= overrides the cookie (handy for screenshots); otherwise the viewer's saved choice.
  const theme = sp.theme ? parseTheme(sp.theme) : await getTheme();
  const navActive = view === "home" ? "home" : view === "batch" ? "batches" : "more";

  return (
    <AppShell
      theme={theme}
      nav={F.NAV}
      active={navActive}
      homeHref="/design?view=home"
      cta={{ href: "/design?view=batch", label: "New batch" }}
      footer={
        <FooterBand
          link={{ href: "/design?view=components", label: `Inbox — ${F.INBOX.flagged} waiting`, sub: "Flagged comments" }}
          status="Worker operational"
          meta="runmysocials · v2 · demo data"
        />
      }
    >
      <div className="border-b border-ds-line">
        <div className={cx(CONTAINER, "flex flex-wrap items-center justify-between gap-3 py-3")}>
          <span className="ds-caps text-ds-muted">Design system v2 · demo</span>
          <div className="w-full sm:w-80">
            <TabLinks
              ariaLabel="Style guide sections"
              items={VIEWS.map((v) => ({ href: `/design?view=${v.id}`, label: v.label, active: v.id === view }))}
            />
          </div>
        </div>
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
    <>
      {/* 01 · Split hero */}
      <section aria-label="This week" className="border-b border-ds-line">
        <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
          <div className="col-span-4 flex min-w-0 flex-col gap-8 py-10 lg:col-span-7 lg:gap-10 lg:py-16 lg:pr-10">
            <div className="flex items-center justify-between">
              <StatusPulse label="Autopilot · on" />
              <span className="ds-mono text-ds-faint">01 / OVERVIEW</span>
            </div>
            <Display
              lines={[
                { text: `Week ${w.number}`, style: "stroke" },
                { text: "approved", style: "serif" },
                { text: `${w.approved}/${w.total}`, style: "solid" },
              ]}
            />
            <ProgressBar value={w.approved} max={w.total} label="Batch approval" />
            <Readout items={F.HERO_READOUT} />
            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink href="/design?view=batch" arrow>
                Review batch
              </ButtonLink>
              <Chip tone="warn">
                <span className="ds-num">{w.warnings}</span>&nbsp;warnings
              </Chip>
            </div>
          </div>
          <div className="col-span-4 min-w-0 pb-10 lg:col-span-5 lg:border-l lg:border-ds-line lg:pb-0">
            <FramedImage alt="Next post preview (placeholder)" ratio="4/5" className="lg:aspect-auto lg:h-full">
              <div className="absolute inset-x-5 bottom-5">
                <GlassCard title="System status" code="OBX-047">
                  <StatusBars rows={F.SYSTEM_STATUS} />
                </GlassCard>
              </div>
            </FramedImage>
          </div>
        </div>
      </section>

      {/* Marquee */}
      <Marquee items={F.MARQUEE} label="Instagram, YouTube, TikTok, Snapchat — week 47 approved" />

      {/* 02 · Up next */}
      <SectionHead index="02" title="Up" serif="next" meta={<span>Today · {F.NEXT_POSTS.length} posts</span>} />
      <div className={CONTAINER}>
        <RevealList
          label="Next posts today"
          items={F.NEXT_POSTS.map((p, i) => ({
            id: p.id,
            index: String(i + 1).padStart(2, "0"),
            title: p.title,
            meta: p.meta,
            href: "/design?view=batch",
            trailing: <PlatformLogo platform={p.platform} size={28} title={PLATFORM_NAME[p.platform]} />,
            image: { alt: `${p.title} preview (placeholder)` },
          }))}
        />
      </div>

      {/* 03 · Numbers */}
      <SectionHead index="03" title="By the" serif="numbers" meta="Last 14 days" id="numbers" />
      <div className={cx(CONTAINER, "py-10 lg:py-16")}>
        <div className={CELLS}>
          <Card
            index="A"
            title="Views"
            className={cx(CELL, "col-span-4 lg:col-span-6")}
            bleed={<AreaChart values={F.VIEWS_14D} height={120} label="Daily views, last 14 days, rising" />}
          >
            <div className="flex items-baseline gap-3">
              <span className="ds-num text-[56px] leading-none font-black tracking-[-0.05em] lg:text-[80px]">{F.VIEWS_TOTAL}</span>
              <Badge tone="accent">{F.VIEWS_DELTA}</Badge>
            </div>
          </Card>
          <Card index="B" title="Flagged" className={cx(CELL, "col-span-2 lg:col-span-3")}>
            <StatTile icon="message" value={F.INBOX.flagged} caption="Need you" tone="accent" />
          </Card>
          <Card index="C" title="Auto-replied" className={cx(CELL, "col-span-2 lg:col-span-3")}>
            <StatTile icon="send" value={F.INBOX.autoReplied} caption="This week" />
          </Card>
          <Card index="D" title="Calendar" className={cx(CELL, "col-span-4 lg:col-span-5")}>
            <MonthCalendar year={F.CALENDAR.year} month0={F.CALENDAR.month0} today={F.CALENDAR.today} marks={F.CALENDAR.marks} label="November 2026" />
          </Card>
          <Card index="E" title="Share of views" className={cx(CELL, "col-span-4 lg:col-span-4")}>
            <Donut segments={F.PER_PLATFORM} centerValue="41%" centerLabel="Instagram" label="Share of views by platform" />
          </Card>
          <Card index="F" title="Alerts" className={cx(CELL, "col-span-4 lg:col-span-3")}>
            <StatTile icon="bell" value={F.ALERTS.open} caption="Open" tone="warn" />
            <p className="mt-4 text-[15px] leading-snug text-ds-muted">{F.ALERTS.latest}</p>
          </Card>
        </div>
      </div>

      {/* Statement */}
      <Statement text={F.STATEMENT.text} source={F.STATEMENT.source} />

      {/* 04 · Journal */}
      <SectionHead index="04" title="Journal" meta="From reports & inbox" />
      <div className={CONTAINER}>
        <ol aria-label="Journal">
          {F.JOURNAL.map((j) => (
            <li key={j.date} className="grid grid-cols-4 items-baseline gap-y-2 border-b border-ds-line py-6 lg:grid-cols-12 lg:py-8">
              <span className="ds-mono col-span-2 text-ds-faint lg:col-span-2">{j.date}</span>
              <span className="col-span-2 justify-self-end lg:col-span-2 lg:justify-self-start">
                <Badge>{j.tag}</Badge>
              </span>
              <p className="col-span-4 text-[18px] leading-snug tracking-[-0.01em] lg:col-span-8 lg:text-[24px]">{j.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

/* ---------- Batch card (proposed) ---------- */

function BatchProposed() {
  const p = F.BATCH_POST;
  const w = F.WEEK;
  return (
    <>
      <TopBar index={`W${w.number}`} title="This" serif="week" meta={`${w.approved}/${w.total} approved`} />
      <div className={cx(CONTAINER, "py-10 lg:py-16")}>
        <div className={CELLS}>
          <article aria-label={p.title} className={cx(CELL, "col-span-4 grid grid-cols-4 border border-ds-line lg:col-span-7 lg:grid-cols-7")}>
            <div className="col-span-1 min-w-0 border-r border-ds-line lg:col-span-3">
              <FramedImage alt={`${p.title} preview (placeholder)`} ratio="9/16">
                <span className="ds-mono absolute bottom-3 right-3 bg-ds-invert px-1.5 py-0.5 text-ds-on-invert">{p.duration}</span>
              </FramedImage>
            </div>
            <div className="col-span-3 flex min-w-0 flex-col gap-3 p-4 lg:col-span-4 lg:p-8">
              <div className="flex items-center justify-between">
                <span className="ds-mono text-ds-faint">{p.index} / {p.day}</span>
                <span className="ds-num text-[15px] font-bold">{p.time}</span>
              </div>
              <h2 className="text-[26px] leading-[0.95] font-black tracking-[-0.04em] lg:text-[44px]">
                Morning <span className="ds-serif font-normal">stretch</span>
              </h2>
              <p className="line-clamp-4 text-[15px] leading-snug text-ds-muted">{p.caption}</p>
              <div className="flex flex-wrap gap-2">
                {p.platforms.map((pl) => (
                  <Chip key={pl}>
                    <PlatformLogo platform={pl} size={14} />
                    {PLATFORM_NAME[pl]}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="col-span-4 flex flex-col gap-4 border-t border-ds-line p-4 lg:col-span-7 lg:p-8">
              <Chip tone="warn">{p.warning}</Chip>
              <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                <Button arrow>Approve</Button>
                <Button variant="outline">Edit</Button>
                <Button variant="icon" aria-label="Reject post" tone="danger">
                  <Icon name="x" />
                </Button>
              </div>
            </div>
          </article>

          <Card index="B" title="Approval" className={cx(CELL, "col-span-4 lg:col-span-5")}>
            <div className="flex items-baseline gap-2">
              <span className="ds-num text-[64px] leading-none font-black tracking-[-0.05em]">{w.approved}</span>
              <span className="ds-serif text-[32px] text-ds-muted">of {w.total}</span>
            </div>
            <div className="mt-6">
              <ProgressBar value={w.approved} max={w.total} label="Approved" showLabel />
            </div>
            <div className="mt-6">
              <Readout items={[{ k: "Pending", v: "06" }, { k: "Warnings", v: "02" }, { k: "First slot", v: "MON 09:00" }, { k: "Mode", v: "DRY-RUN" }]} />
            </div>
            <div className="mt-8">
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
        </div>
      </div>
      <SectionHead index="02" title="Rest of the" serif="week" meta="5 more" />
      <div className={cx(CONTAINER, "pb-10")}>
        <RevealList
          label="Rest of the week"
          items={[
            { id: "r1", index: "04", title: "Rest-day meals", meta: "WED 12:30 · SHORT", platform: "youtube" as Platform },
            { id: "r2", index: "05", title: "One-pan dinner", meta: "WED 17:15 · DRAFT", platform: "tiktok" as Platform },
            { id: "r3", index: "06", title: "Desk, before & after", meta: "THU 19:00 · SPOTLIGHT", platform: "snapchat" as Platform },
          ].map((r) => ({
            ...r,
            href: "/design?view=batch",
            trailing: <PlatformLogo platform={r.platform} size={28} title={PLATFORM_NAME[r.platform]} />,
            image: { alt: `${r.title} preview (placeholder)` },
          }))}
        />
      </div>
    </>
  );
}

/* ---------- Component gallery ---------- */

function Section({ title, index, span = "lg:col-span-4", children }: { title: string; index: string; span?: string; children: ReactNode }) {
  return (
    <Card index={index} title={title} className={cx(CELL, "col-span-4", span)}>
      <div className="flex flex-col gap-5">{children}</div>
    </Card>
  );
}

function Components({ theme }: { theme: Theme }) {
  return (
    <>
      <TopBar index="UI" title="The" serif="kit" meta="Every part, every state" />
      <div className={cx(CONTAINER, "py-10 lg:py-16")}>
        <div className={CELLS}>
          <Section index="01" title="Buttons">
            <Button block arrow>Approve batch</Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline">Edit</Button>
              <Button variant="accent">Share</Button>
              <Button variant="ghost">Skip</Button>
              <Button variant="outline" tone="danger">Reject</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="icon" aria-label="Search"><Icon name="search" /></Button>
              <Button variant="pill">New batch</Button>
              <Button size="sm">Small</Button>
              <Button size="sm" disabled>Disabled</Button>
            </div>
          </Section>

          <Section index="02" title="Status & readouts">
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <StatusPulse label="Live" />
              <StatusPulse label="Needs you" tone="warn" />
              <StatusPulse label="Failed" tone="danger" />
              <StatusPulse label="Paused" tone="muted" />
            </div>
            <Readout items={[{ k: "Outbox", v: "0 failed" }, { k: "Next", v: "09:00 IG" }, { k: "Tokens", v: "OK · 54 d" }, { k: "Mode", v: "DRY-RUN" }]} />
            <StatusBars rows={F.SYSTEM_STATUS.slice(0, 2)} />
          </Section>

          <Section index="03" title="Platform logos">
            <div className="flex items-center justify-between px-1">
              {(["instagram", "youtube", "tiktok", "snapchat"] as Platform[]).map((pl) => (
                <span key={pl} className="flex flex-col items-center gap-2">
                  <PlatformLogo platform={pl} size={30} title={PLATFORM_NAME[pl]} />
                  <span className="ds-caps text-ds-muted">{PLATFORM_NAME[pl]}</span>
                </span>
              ))}
            </div>
            <ThemeToggle initial={theme} variant="row" />
          </Section>

          <Section index="04" title="Toggles">
            <Toggle label="Auto-reply to comments" defaultChecked description="Routine replies in your voice" />
            <Toggle label="Kill switch" variant="icon" />
            <Toggle label="Weekly report email" variant="text" defaultChecked />
            <Toggle label="Disabled setting" disabled />
          </Section>

          <Section index="05" title="Choices">
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

          <Section index="06" title="Tabs & badges">
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

          <Section index="07" title="Inputs">
            <SearchField label="Search clips" name="q" placeholder="Search clips" />
            <Input label="Caption hook" name="hook" placeholder="Three minutes, no equipment…" helper="Keep it under 60 characters." />
            <PasswordInput label="Password" name="pw" defaultValue="demo-value" helper="Example only." />
            <Input label="Title" name="t" defaultValue="Way too long title" error="YouTube titles max out at 100 characters." />
          </Section>

          <Section index="08" title="Select, stepper, progress">
            <Select label="Pillar" name="pillar" defaultValue="move">
              <option value="move">Movement</option>
              <option value="food">Food</option>
              <option value="desk">Desk & tools</option>
            </Select>
            <Stepper label="Posts per day" name="ppd" defaultValue={3} min={1} max={6} />
            <ProgressBar value={62} label="Upload" showLabel />
            <Slider label="Reply delay (min)" defaultValue={12} min={0} max={60} />
          </Section>

          <Section index="09" title="Rows, stats, charts">
            <ListRows label="Accounts">
              <ListRow avatar={{ platform: "instagram" }} title="Instagram" subtitle="GRAPH API · DIRECT" trailing="3" trailingSub="today" href="/design?view=home" />
              <ListRow avatar={{ platform: "snapchat" }} title="Snapchat" subtitle="ASSISTED · TAP TO SHARE" trailing="1" trailingSub="to share" />
            </ListRows>
            <div className="flex items-end justify-between gap-4">
              <StatTile icon="eye" value="8.7k" caption="Views yesterday" tone="accent" />
              <Sparkline values={[3, 4, 3.5, 5, 4.8, 6, 6.4]} label="Followers trend, rising" />
            </div>
            <MiniBars values={F.POSTS_PER_DAY} labels={F.DAY_LABELS} highlightIndex={5} label="Posts per day" />
          </Section>

          <Section index="10" title="Alerts" span="lg:col-span-8">
            <div className="grid gap-4 sm:grid-cols-2">
              <AlertCard title="Attention" action={<Button size="sm" variant="accent">Review</Button>}>
                Instagram token expires in 6 days. Reconnect to keep posting.
              </AlertCard>
              <AlertCard tone="light" title="Attention" action={<Button size="sm">Small button</Button>}>
                TikTok draft needs a sound before it can go out.
              </AlertCard>
            </div>
          </Section>

          <Section index="11" title="Empty, tooltip, sheet">
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
        </div>
      </div>
    </>
  );
}
