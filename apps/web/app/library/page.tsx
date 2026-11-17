import { AppFrame } from "../../components/AppFrame.js";
import { loadFrameCounts } from "../../components/frame-counts.js";
import { ClipDialog, ClipTile, FocusScroll } from "../../components/library/index.js";
import { Button, ButtonLink, Dropdown, EmptyState, InlineNotice, PageHeader, SearchField } from "../../components/ui/index.js";
import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";
import { loadLibrary, loadTouchUp, type LibraryClip } from "../../lib/library/data.js";
import { loadPillars } from "../../lib/library/pillars.js";
import { libraryUrl, parseLibraryParams, pillarOptions, resultNote, tagOptions } from "../../lib/library/screen.js";

export const dynamic = "force-dynamic"; // always the latest ingest
export const metadata = { title: "Library · My Socials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** v3 Library: search, topic and tag filters, the poster grid, and the clip Dialog (`?clip=`). */
export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const p = parseLibraryParams(sp);
  const pool = getPool();

  const [counts, page, pillars] = await Promise.all([
    loadFrameCounts(pool),
    loadLibrary(pool, { q: p.q, pillar: p.pillar ?? undefined, tag: p.tag ?? undefined, cursor: p.cursor, focus: p.focus }),
    loadPillars(pool),
  ]);

  // The open clip: from this page, else on its own (a deep link to a clip further down).
  let open: LibraryClip | null = null;
  if (p.clip) open = page.clips.find((c) => c.mediaId === p.clip) ?? (await loadLibrary(pool, { focus: p.clip, limit: 1 })).clips.find((c) => c.mediaId === p.clip) ?? null;
  const touch = open && open.flagged > 0 ? ((await loadTouchUp(pool)).find((c) => c.mediaId === open.mediaId) ?? null) : null;

  const filtered = Boolean(p.q || p.pillar || p.tag);
  const note = resultNote(sp);
  const toTouch = counts.touchUp ?? 0;
  const focusId = page.clips[0]?.focused ? page.clips[0].mediaId : null;

  return (
    <AppFrame active="library" counts={counts}>
      <PageHeader
        title="Library"
        subtitle="Every clip from your editors, newest first."
        action={
          toTouch > 0 ? (
            <ButtonLink href="/library/touch-up" variant="outline">
              {toTouch === 1 ? "1 needs a touch-up" : `${toTouch} need a touch-up`}
            </ButtonLink>
          ) : undefined
        }
      />

      {note ? (
        <InlineNotice tone={note.tone} live className="mb-3 lg:mb-4">
          {note.text}
        </InlineNotice>
      ) : null}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center lg:mb-4">
        <form action="/library" method="get" role="search" className="flex min-w-0 flex-1 gap-2">
          <SearchField label="Search clips" name="q" defaultValue={p.q} placeholder="File name or topic" autoComplete="off" className="min-w-0 flex-1 sm:max-w-[420px]" />
          {p.pillar ? <input type="hidden" name="pillar" value={p.pillar} /> : null}
          {p.tag ? <input type="hidden" name="tag" value={p.tag} /> : null}
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <div className="flex gap-2">
          <Dropdown label="Topic" align="start" options={pillarOptions(pillars, p)} />
          <Dropdown label="Tag" align="end" options={tagOptions(p)} />
        </div>
      </div>

      {page.clips.length === 0 ? (
        <div className="rounded-ds-lg border border-ds-line bg-ds-card">
          {filtered ? (
            <EmptyState
              icon="search"
              title="No clips match"
              body="Try part of a file name or another topic."
              action={
                <ButtonLink href="/library" variant="outline" size="sm">
                  Clear the filters
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              icon="film"
              title="No clips yet"
              body="Drop renders into the editor folder. They show up here after the next ingest."
              action={
                <ButtonLink href="/calendar" variant="outline" size="sm">
                  Open the calendar
                </ButtonLink>
              }
            />
          )}
        </div>
      ) : (
        <>
          <ul aria-label="Clips" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:gap-4">
            {page.clips.map((c) => (
              <li key={c.mediaId} className="min-w-0">
                <ClipTile clip={c} href={libraryUrl({ ...p, clip: c.mediaId })} />
              </li>
            ))}
          </ul>
          {page.nextCursor || p.cursor ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2 lg:mt-6">
              {p.cursor ? (
                <ButtonLink href={libraryUrl({ q: p.q, pillar: p.pillar, tag: p.tag })} variant="ghost">
                  Back to the newest
                </ButtonLink>
              ) : null}
              {page.nextCursor ? (
                <ButtonLink href={libraryUrl({ q: p.q, pillar: p.pillar, tag: p.tag, cursor: page.nextCursor })} variant="outline">
                  Show more
                </ButtonLink>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {focusId && !open ? <FocusScroll targetId={`clip-${focusId}`} /> : null}
      {open ? <ClipDialog clip={open} touch={touch} closeHref={libraryUrl({ ...p, clip: null })} back={libraryUrl(p)} /> : null}
    </AppFrame>
  );
}
