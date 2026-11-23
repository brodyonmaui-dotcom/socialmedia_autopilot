import Link from "next/link";
import { AppFrame } from "../../../components/AppFrame.js";
import { loadFrameCounts } from "../../../components/frame-counts.js";
import { ReelForm } from "../../../components/library/ReelForm.js";
import { Badge, ButtonLink, Card, cx, DataList, EmptyState, FOCUS, Icon, InlineNotice, PageHeader, Thumb } from "../../../components/ui/index.js";
import { requireSession } from "../../../lib/auth/require.js";
import { getPool } from "../../../lib/db.js";
import { creatorZone } from "../../../lib/calendar/load.js";
import { listReels, listSounds, loadReelSource, SOUND_RIGHTS_NOTE, type ReelView } from "../../../lib/reels/data.js";

export const dynamic = "force-dynamic"; // queued → running → done moves every minute
export const metadata = { title: "Reels · My Socials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const STATUS: Record<ReelView["status"], { label: string; tone: "neutral" | "accent" | "warn" | "danger" }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Making…", tone: "warn" },
  done: { label: "Draft ready", tone: "accent" },
  failed: { label: "Failed", tone: "danger" },
};

/**
 * F20 E Reels: `?clip=<mediaId>` shows the Make-a-reel form for that library clip; below it, every reel
 * with its state (queued / making / draft ready / failed) and, once done, a link to its draft in the calendar.
 */
export default async function ReelsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const pool = getPool();
  const { timeZone } = creatorZone();
  const clipId = one(sp.clip) ?? null;
  const [counts, reels, source, sounds] = await Promise.all([
    loadFrameCounts(pool),
    listReels(pool, timeZone),
    clipId ? loadReelSource(pool, clipId) : Promise.resolve(null),
    clipId ? listSounds(pool) : Promise.resolve([]),
  ]);
  const queued = one(sp.done) === "queued";

  return (
    <AppFrame active="library" counts={counts}>
      <PageHeader
        title="Reels"
        subtitle="A library clip + a sound, made vertical and saved as a draft post."
        action={
          <ButtonLink href="/library/sounds" variant="outline">
            Sounds
          </ButtonLink>
        }
      />
      {queued ? (
        <InlineNotice tone="info" live className="mb-3 lg:mb-4">
          Reel queued. It takes a minute or two; the draft shows up in the calendar when it&rsquo;s ready.
        </InlineNotice>
      ) : null}

      {clipId ? (
        source ? (
          <Card title="Make a reel" subtitle={source.label} className="mb-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <Thumb mediaId={source.hasPoster ? source.mediaId : null} alt={`${source.label} poster`} className="w-[96px] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="ds-helper mb-3">{SOUND_RIGHTS_NOTE}</p>
                <ReelForm mediaId={source.mediaId} durationS={source.durationS} hasAudio={source.hasAudio} sounds={sounds.map((s) => ({ id: s.id, name: s.name }))} />
              </div>
            </div>
          </Card>
        ) : (
          <InlineNotice tone="danger" className="mb-3 lg:mb-4">
            That clip can&rsquo;t be used for a reel (it&rsquo;s archived or has no clean file yet).
          </InlineNotice>
        )
      ) : null}

      {reels.length === 0 ? (
        <div className="rounded-ds-lg border border-ds-line bg-ds-card">
          <EmptyState
            icon="film"
            title="No reels yet"
            body="Open a clip in the Library and tap Make a reel."
            action={
              <ButtonLink href="/library" variant="outline">
                Open Library
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <div className="rounded-ds-lg border border-ds-line bg-ds-card px-3">
          <DataList label="Reels">
            {reels.map((r) => (
              <li key={r.id} className="flex min-h-11 min-w-0 flex-col gap-1 py-3">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[15px] font-semibold text-ds-text">{r.label}</span>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </div>
                <span className="ds-helper ds-num">Asked {r.requested}</span>
                {r.error ? <span className="text-[14px] text-ds-danger">{r.error}</span> : null}
                {r.calendarHref ? (
                  <Link href={r.calendarHref} className={cx("-mx-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-ds-sm px-1 text-[14px] font-semibold text-ds-accent-fg hover:bg-ds-raised lg:min-h-8", FOCUS)}>
                    <Icon name="calendar" size={16} />
                    <span className="ds-num">{r.postAt ? `Draft for ${r.postAt}` : "Draft in the calendar (no time yet)"}</span>
                    <Icon name="chevronRight" size={16} />
                  </Link>
                ) : null}
              </li>
            ))}
          </DataList>
        </div>
      )}
    </AppFrame>
  );
}
