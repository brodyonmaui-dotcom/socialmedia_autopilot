import Link from "next/link";
import type { Pool } from "pg";
import { localHHMM } from "@autopilot/core";
import { loadPostRecords, pickSnapchatDaily, type SnapchatPick } from "@autopilot/analytics";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { mediaLabel } from "../../lib/batches/pg-store.js";
import { handoffContext, listHandoff } from "../../lib/handoff/store.js";
import type { HandoffItem } from "../../lib/handoff/types.js";
import { HandoffCard } from "./ui/HandoffCard.js";

export const dynamic = "force-dynamic";

const NAME = { instagram: "Instagram", tiktok: "TikTok" } as const;

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

function Section({ title, items, timeZone }: { title: string; items: HandoffItem[]; timeZone: string }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      <ul className="mt-2 space-y-3">
        {items.map((it) => (
          <HandoffCard key={it.id} item={it} when={`${it.localDay} · ${localHHMM(new Date(it.scheduledFor), timeZone)}`} />
        ))}
      </ul>
    </section>
  );
}

export default async function HandoffPage() {
  await requireSession();
  const pool = getPool();
  const now = new Date();
  const ctx = handoffContext();

  const header = (
    <div className="flex items-center justify-between">
      <h1 className="text-xl font-semibold">Snapchat handoff</h1>
      <Link href="/" className="inline-flex min-h-11 items-center text-neutral-500 underline">
        dashboard
      </Link>
    </div>
  );

  // No zone → no "today". Guessing UTC could put a share on the wrong day (a double share).
  if (!ctx.timeZone) {
    return (
      <main className="mx-auto max-w-md p-4 text-base">
        {header}
        <p role="alert" className="mt-4 rounded-lg border border-amber-400 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          TZ_CREATOR not set
        </p>
      </main>
    );
  }

  const list = await listHandoff(pool, now, ctx.timeZone, ctx.blocklist);
  const empty = list.today.length === 0 && list.missed.length === 0;
  const pick = empty ? await suggestion(pool, now) : null;

  return (
    <main className="mx-auto max-w-md p-4 pb-12 text-base">
      {header}
      <p className="mt-1 text-sm text-neutral-500">Assisted route: Prepare → Share → Snapchat → Spotlight, then Mark posted.</p>
      <Section title="Today" items={list.today} timeZone={ctx.timeZone} />
      <Section title="Missed" items={list.missed} timeZone={ctx.timeZone} />
      {empty ? (
        <div className="mt-4 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <p>Nothing to share today.</p>
          {pick ? (
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              Suggestion (read-only): <span className="font-semibold">{pick.label}</span>, {pick.score.toFixed(1)}× the {NAME[pick.platform]} median (
              {pick.views.toLocaleString("en")} views). Add it to a batch and approve it to share it here.
            </p>
          ) : (
            <p className="mt-2 text-sm text-neutral-500">No suggestion yet: needs recent Instagram/TikTok views.</p>
          )}
          <Link href="/batches" className="mt-2 inline-flex min-h-11 items-center underline">
            Go to batches
          </Link>
        </div>
      ) : null}
    </main>
  );
}
