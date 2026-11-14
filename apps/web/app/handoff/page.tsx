import type { Pool } from "pg";
import { addCalendarDays, localDate, localHHMM, localToUtc } from "@autopilot/core";
import { loadPostRecords, pickSnapchatDaily, type SnapchatPick } from "@autopilot/analytics";
import { AppFrame } from "../../components/AppFrame.js";
import {
  AlertCard,
  Badge,
  ButtonLink,
  CONTAINER,
  Display,
  EmptyState,
  FooterBand,
  ListRow,
  ListRows,
  PlatformLogo,
  ProgressBar,
  Readout,
  SectionHead,
  StatusPulse,
  cx,
} from "../../components/ui/index.js";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { mediaLabel } from "../../lib/batches/pg-store.js";
import { handoffContext, listHandoff } from "../../lib/handoff/store.js";
import type { HandoffItem } from "../../lib/handoff/types.js";
import { dailyProgress, heroLines, plural, pulseFor, suggestionMeta, todayMeta } from "../../lib/handoff/view.js";
import { HandoffCard } from "./ui/HandoffCard.js";

export const dynamic = "force-dynamic";

/**
 * Read-only "what to send next" when nothing is due (F10 OQ2): the daily pick over the last 28 days of
 * published posts (one query, same loader as /analytics). Turning it into a post goes through a batch
 * draft + approval, never from here.
 */
async function suggestion(pool: Pool, now: Date): Promise<(SnapchatPick & { label: string }) | null> {
  const [posts, sent] = await Promise.all([
    loadPostRecords(pool, new Date(now.getTime() - 28 * 86_400_000)),
    pool.query("select distinct media_id from batch_items where platform = 'snapchat' and status in ('approved', 'published') and media_id is not null"),
  ]);
  const pick = pickSnapchatDaily(posts, { now, alreadySent: sent.rows.map((r) => r.media_id as string) });
  if (!pick) return null;
  const m = pick.mediaId ? (await pool.query("select source_path from media where id = $1", [pick.mediaId])).rows[0] : undefined;
  return { ...pick, label: mediaLabel((m?.source_path as string | null | undefined) ?? null, pick.mediaId ?? pick.batchItemId) };
}

/** Snapchat items marked posted during the creator-local today (read-only; feeds the 1-a-day bar). */
async function sharedToday(pool: Pool, now: Date, timeZone: string): Promise<number> {
  const today = localDate(now, timeZone);
  const r = await pool.query(
    "select count(*)::int as n from batch_items where platform = 'snapchat' and status = 'published' and updated_at >= $1 and updated_at < $2",
    [localToUtc(today, "00:00", timeZone), localToUtc(addCalendarDays(today, 1), "00:00", timeZone)],
  );
  return (r.rows[0]?.n as number | undefined) ?? 0;
}

const when = (it: HandoffItem, timeZone: string) => `${it.localDay} · ${localHHMM(new Date(it.scheduledFor), timeZone)}`;

const footer = <FooterBand link={{ href: "/batches", label: "Batches", sub: "Snapchat posts come from approved batches" }} status="Assisted route · you share" meta="runmysocials · approval first" />;

export default async function HandoffPage() {
  await requireSession();
  const pool = getPool();
  const now = new Date();
  const ctx = handoffContext();

  // No zone → no "today". Guessing UTC could put a share on the wrong day (a double share).
  if (!ctx.timeZone) {
    return (
      <AppFrame active="handoff" footer={footer}>
        <SectionHead index="F10" title="Snapchat" serif="handoff" meta="Assisted route" />
        <div className={cx(CONTAINER, "py-10")}>
          <AlertCard tone="light" title="TZ_CREATOR not set" live>
            The page won&apos;t guess &ldquo;today&rdquo;: a wrong day could mean a double share. Set it in the server .env.
          </AlertCard>
        </div>
      </AppFrame>
    );
  }

  const [list, shared] = await Promise.all([listHandoff(pool, now, ctx.timeZone, ctx.blocklist), sharedToday(pool, now, ctx.timeZone)]);
  const empty = list.today.length === 0 && list.missed.length === 0;
  const pick = empty ? await suggestion(pool, now) : null;
  const pulse = pulseFor(list.today.length, list.missed.length, shared);
  const progress = dailyProgress(shared);
  const tz = ctx.timeZone;

  return (
    <AppFrame active="handoff" footer={footer}>
      {/* Hero: 1-a-day status */}
      <section aria-label="Snapchat today" className="border-b border-ds-line">
        <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
          <div className="col-span-4 flex min-w-0 flex-col gap-8 py-10 lg:col-span-7 lg:gap-10 lg:py-16 lg:pr-10">
            <div className="flex items-center justify-between gap-3">
              <StatusPulse tone={pulse.tone} label={pulse.label} />
              <span className="ds-mono text-ds-faint">F10 / HANDOFF</span>
            </div>
            <Display lines={heroLines(shared)} />
            <ProgressBar value={progress.value} max={progress.max} valueText={progress.text} label="Spotlight today" showLabel />
          </div>
          <div className="col-span-4 flex min-w-0 flex-col justify-end gap-6 pb-10 lg:col-span-5 lg:border-l lg:border-ds-line lg:py-16 lg:pl-10">
            <p className="flex items-center gap-3 text-[20px] font-bold leading-tight tracking-[-0.02em]">
              <PlatformLogo platform="snapchat" size={24} title="Snapchat" />
              You share, the app keeps count.
            </p>
            <p className="ds-note">Copy the caption, Prepare, Share → Snapchat → Spotlight. Check location is off. Then Mark posted.</p>
            <Readout
              items={[
                { k: "Today", v: plural(list.today.length, "post") },
                { k: "Missed", v: plural(list.missed.length, "post") },
                { k: "Route", v: "Assisted" },
                { k: "Limit", v: "1 per day" },
              ]}
            />
          </div>
        </div>
      </section>

      {list.today.length > 0 && (
        <section aria-labelledby="today">
          <SectionHead index="01" title="Share" serif="today" meta={todayMeta(list.today)} id="today" />
          {list.today.map((it) => (
            <HandoffCard key={it.id} item={it} when={when(it, tz)} />
          ))}
        </section>
      )}

      {list.missed.length > 0 && (
        <section aria-labelledby="missed">
          <SectionHead index={list.today.length > 0 ? "02" : "01"} title="Missed" serif="days" meta={`${plural(list.missed.length, "item")} · share, skip or drop`} id="missed" />
          {list.missed.map((it) => (
            <HandoffCard key={it.id} item={it} when={when(it, tz)} missed />
          ))}
        </section>
      )}

      {empty && (
        <section aria-labelledby="nothing">
          <SectionHead index="01" title="Nothing" serif="due" meta={shared > 0 ? "Today's Spotlight is done" : "No approved Snapchat post today"} id="nothing" />
          <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
            <EmptyState
              icon="share"
              title="Nothing to share today"
              body="Approved Snapchat posts show up here on their day. Add one to a batch and approve it there."
              action={
                <ButtonLink href="/batches" variant="outline" size="sm" arrow>
                  Go to batches
                </ButtonLink>
              }
              className="col-span-4 border-b border-ds-line py-16 lg:col-span-5 lg:border-b-0 lg:border-r"
            />
            <div className="col-span-4 flex min-w-0 flex-col gap-4 py-10 lg:col-span-7 lg:pl-10 lg:py-16">
              <div className="flex items-center justify-between gap-3">
                <p className="ds-caps text-ds-muted">Suggestion</p>
                <Badge tone="neutral">Read-only</Badge>
              </div>
              {pick ? (
                <>
                  <ListRows label="Suggested clip" className="border-y border-ds-line">
                    <ListRow avatar={{ platform: pick.platform }} title={pick.label} subtitle={suggestionMeta(pick)} trailing={`${pick.score.toFixed(1)}×`} />
                  </ListRows>
                  <p className="ds-note">Best recent performer not yet sent to Snapchat. The app never adds Snapchat posts on its own.</p>
                </>
              ) : (
                <p className="ds-note">No suggestion yet: needs recent Instagram/TikTok views.</p>
              )}
            </div>
          </div>
        </section>
      )}
    </AppFrame>
  );
}
