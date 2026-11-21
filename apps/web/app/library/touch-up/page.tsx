import { AppFrame } from "../../../components/AppFrame.js";
import { loadFrameCounts } from "../../../components/frame-counts.js";
import { FixAllDialog, KeepAllDialog, TouchUpCard } from "../../../components/library/index.js";
import Link from "next/link";
import { buttonClasses, ButtonLink, EmptyState, InlineNotice, PageHeader } from "../../../components/ui/index.js";
import { requireSession } from "../../../lib/auth/require.js";
import { getPool } from "../../../lib/db.js";
import { loadFixProgress, loadTouchUp } from "../../../lib/library/data.js";
import { cardStage, fixAllPlan, fixProgressText, resultNote, touchUpHeadline, touchUpOrder } from "../../../lib/library/screen.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Touch-up · My Socials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const BASE = "/library/touch-up";

/**
 * v3 Touch-up: only clips with a real issue. "Fix all N" (confirm Dialog, `?fixall=1`), then one card per
 * clip with its state: Fix it / Dismiss, Fixing…, before → after with Keep the fix / Keep the original, or
 * the failure reason with Try again. Originals are never changed.
 */
export default async function TouchUpPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const pool = getPool();
  const [counts, clips, progress] = await Promise.all([loadFrameCounts(pool), loadTouchUp(pool), loadFixProgress(pool)]);
  const plan = fixAllPlan(clips);
  const note = resultNote(sp);
  const n = plan.ids.length;
  const keepN = progress.done;
  const progressText = fixProgressText(progress.pending, progress.done);

  return (
    <AppFrame active="library/touch-up" counts={{ ...counts, touchUp: clips.length }}>
      <PageHeader
        title="Touch-up"
        subtitle={clips.length ? `${touchUpHeadline(clips.length)}. Originals are always kept.` : "Clips with something to fix show up here."}
        action={
          n > 0 || keepN > 0 ? (
            <div className="flex flex-wrap gap-2">
              {keepN > 0 ? (
                <Link href={`${BASE}?keepall=1`} scroll={false} className={buttonClasses({ variant: "solid" })}>
                  Keep all {keepN} {keepN === 1 ? "fix" : "fixes"}
                </Link>
              ) : null}
              {n > 0 ? (
                <Link href={`${BASE}?fixall=1`} scroll={false} className={buttonClasses({ variant: keepN > 0 ? "outline" : "solid" })}>
                  Fix all {n}
                </Link>
              ) : null}
            </div>
          ) : undefined
        }
      />

      {note ? (
        <InlineNotice tone={note.tone} live className="mb-3 lg:mb-4">
          {note.text}
        </InlineNotice>
      ) : null}

      {progressText ? (
        <p role="status" className="mb-3 text-[14px] text-ds-muted lg:mb-4">
          {progressText}
        </p>
      ) : null}

      {clips.length === 0 ? (
        <div className="rounded-ds-lg border border-ds-line bg-ds-card">
          <EmptyState
            icon="check"
            title="Nothing needs fixing."
            body="New clips are checked when they come in. Anything with a frozen end, odd sound level or wrong shape shows up here."
            action={
              <ButtonLink href="/library" variant="outline" size="sm">
                Open the library
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <ul aria-label="Clips to touch up" className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4">
          {touchUpOrder(clips).map((c) => {
            const wide = cardStage(c) === "review";
            return (
              <li key={c.mediaId} className={wide ? "min-w-0 lg:col-span-2" : "min-w-0"}>
                <TouchUpCard clip={c} back={BASE} wide={wide} />
              </li>
            );
          })}
        </ul>
      )}

      {sp.keepall === "1" && keepN > 0 ? <KeepAllDialog n={keepN} closeHref={BASE} back={BASE} /> : null}
      {sp.fixall === "1" ? <FixAllDialog plan={plan} closeHref={BASE} back={BASE} /> : null}
    </AppFrame>
  );
}
