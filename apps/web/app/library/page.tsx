import { AppFrame } from "../../components/AppFrame.js";
import { loadFrameCounts } from "../../components/frame-counts.js";
import { ClipDialog, ClipTile, FocusScroll, SelectSectionButton, SelectShell } from "../../components/library/index.js";
import { Button, ButtonLink, ChipLink, cx, Dropdown, EmptyState, FOCUS, Icon, InlineNotice, PageHeader, SearchField } from "../../components/ui/index.js";
import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";
import { hasFolderColumn, loadClipUses, loadFolders, loadLibrary, loadLibraryCounts, loadTouchUp, type LibraryClip } from "../../lib/library/data.js";
import { loadPillars } from "../../lib/library/pillars.js";
import { clipUseLines, EMPTY_BY_STATUS, groupClips, groupOptions, libraryUrl, parseLibraryParams, pillarOptions, resultNote, sortOptions, statusChips, tagOptions } from "../../lib/library/screen.js";
import { creatorZone } from "../../lib/calendar/load.js";

export const dynamic = "force-dynamic"; // always the latest ingest
export const metadata = { title: "Library · My Socials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** v3 Library: search, topic and tag filters, the poster grid, and the clip Dialog (`?clip=`). */
export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const p = parseLibraryParams(sp);
  const pool = getPool();
  try {
    return await renderLibrary(p, sp, pool);
  } catch (err) {
    // Any loader failure: a card with the error class only (never a stack or SQL), so the page never goes blank.
    console.error(`library page failed: ${(err as Error).name}`);
    return (
      <AppFrame active="library" counts={await loadFrameCounts(pool).catch(() => ({}))}>
        <PageHeader title="Library" subtitle="Every clip from your editors." />
        <div className="rounded-ds-lg border border-ds-line bg-ds-card">
          <EmptyState
            icon="alert"
            title="The library couldn't load"
            body={`Something went wrong reading your clips (${errorClass(err)}). Nothing was changed. Try again in a moment.`}
            action={
              <ButtonLink href="/library" variant="outline" size="sm">
                Try again
              </ButtonLink>
            }
          />
        </div>
      </AppFrame>
    );
  }
}

/** "DatabaseError", "TypeError"…: the class name only, letters and digits. */
function errorClass(err: unknown): string {
  const n = err instanceof Error ? err.name : "Error";
  return /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(n) ? n : "Error";
}

async function renderLibrary(p: ReturnType<typeof parseLibraryParams>, sp: Awaited<SearchParams>, pool: ReturnType<typeof getPool>) {
  const zone = creatorZone().timeZone;
  const foldersOn = await hasFolderColumn(pool);
  const group = !foldersOn && p.group === "folder" ? "week" : p.group;
  const now = new Date();

  const [frame, page, pillars, folders, statusCounts] = await Promise.all([
    loadFrameCounts(pool),
    loadLibrary(pool, { q: p.q, pillar: p.pillar ?? undefined, tag: p.tag ?? undefined, cursor: p.cursor, focus: p.focus, status: p.status, sort: p.sort, now }),
    loadPillars(pool),
    loadFolders(pool),
    loadLibraryCounts(pool, { q: p.q, pillar: p.pillar ?? undefined }),
  ]);
  const counts = frame;

  // The open clip: from this page, else on its own (a deep link to a clip further down). Not in select mode.
  let open: LibraryClip | null = null;
  if (p.clip && !p.select) open = page.clips.find((c) => c.mediaId === p.clip) ?? (await loadLibrary(pool, { focus: p.clip, limit: 1, now })).clips.find((c) => c.mediaId === p.clip) ?? null;
  const touch = open && open.flagged > 0 ? ((await loadTouchUp(pool)).find((c) => c.mediaId === open.mediaId) ?? null) : null;
  // Only the open clip's next few uses (one small query; the grid keeps its count only).
  const uses = open && open.usedIn > 0 ? clipUseLines(await loadClipUses(pool, open.mediaId, now), zone) : [];

  const filtered = Boolean(p.q || p.pillar || p.tag);
  const note = resultNote(sp);
  const toTouch = counts.touchUp ?? 0;
  const sections = groupClips(page.clips, group, zone);
  const focusId = page.clips[0]?.focused ? page.clips[0].mediaId : null;
  const empty = EMPTY_BY_STATUS[p.status];
  const back = libraryUrl({ ...p, select: false, clip: null, cursor: null, focus: null });
  const more = (cursor: string | null) => libraryUrl({ ...p, clip: null, focus: null, cursor });

  const grid = (clips: LibraryClip[], title: string | null) => (
    <ul aria-label={title ?? "Clips"} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:gap-4">
      {clips.map((c) => (
        <li key={c.mediaId} className="min-w-0">
          <ClipTile clip={c} href={libraryUrl({ ...p, clip: c.mediaId })} timeZone={zone} selectable={p.select} />
        </li>
      ))}
    </ul>
  );

  const list = (
    <>
      {sections.map((sec) =>
        sec.title === null ? (
          <div key={sec.key} data-select-scope>
            {p.select ? <SelectSectionButton label="Select all" className="mb-1" /> : null}
            {grid(sec.clips, null)}
          </div>
        ) : (
          <details key={sec.key} open className="mb-4 lg:mb-6" data-select-scope>
            <summary className={cx("mb-2 flex min-h-11 cursor-pointer list-none items-center gap-2 text-[15px] font-semibold text-ds-text [&::-webkit-details-marker]:hidden", FOCUS)}>
              <Icon name="chevronDown" size={16} className="text-ds-muted" />
              <span>{sec.title}</span>
              <span className="ds-num font-normal text-ds-muted">{sec.count}</span>
            </summary>
            {p.select ? <SelectSectionButton className="mb-1" /> : null}
            {grid(sec.clips, sec.title)}
          </details>
        ),
      )}
    </>
  );

  return (
    <AppFrame active="library" counts={counts}>
      <PageHeader
        title="Library"
        subtitle="Every clip from your editors. Pick what to schedule next."
        action={
          <div className="flex flex-wrap gap-2">
            {toTouch > 0 ? (
              <ButtonLink href="/library/touch-up" variant="outline">
                {toTouch === 1 ? "1 needs a touch-up" : `${toTouch} need a touch-up`}
              </ButtonLink>
            ) : null}
            <ButtonLink href="/library/upload" variant="solid">
              Upload
            </ButtonLink>
          </div>
        }
      />

      {note ? (
        <InlineNotice tone={note.tone} live className="mb-3 lg:mb-4">
          {note.text}
        </InlineNotice>
      ) : null}
      {!foldersOn ? (
        <InlineNotice tone="warn" className="mb-3 lg:mb-4">
          Folders need database update 0016. Ask to apply it (docs/runbooks/migrations.md).
        </InlineNotice>
      ) : null}

      <nav aria-label="Show clips" className="-mx-[var(--ds-gutter)] mb-3 flex gap-2 overflow-x-auto px-[var(--ds-gutter)] pb-1 lg:mx-0 lg:mb-4 lg:px-0">
        {statusChips(p, statusCounts).map((c) => (
          <ChipLink key={c.status} href={c.href} current={c.current} count={c.count}>
            {c.label}
          </ChipLink>
        ))}
      </nav>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center lg:mb-4">
        <form action="/library" method="get" role="search" className="flex min-w-0 flex-1 gap-2">
          <SearchField label="Search clips" name="q" defaultValue={p.q} placeholder="Clip name" autoComplete="off" className="min-w-0 flex-1 sm:max-w-[420px]" />
          {p.pillar ? <input type="hidden" name="pillar" value={p.pillar} /> : null}
          {p.group !== "week" ? <input type="hidden" name="group" value={p.group} /> : null}
          {p.tag ? <input type="hidden" name="tag" value={p.tag} /> : null}
          {p.status !== "ready" ? <input type="hidden" name="status" value={p.status} /> : null}
          {p.sort !== "newest" ? <input type="hidden" name="sort" value={p.sort} /> : null}
          {p.select ? <input type="hidden" name="select" value="1" /> : null}
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Dropdown label="Sort" align="start" options={sortOptions(p)} />
          <Dropdown label="Group by" align="start" options={groupOptions({ ...p, group }, foldersOn)} />
          <Dropdown label="Topic" align="start" options={pillarOptions(pillars, p)} />
          <Dropdown label="Tag" align="end" options={tagOptions(p)} />
          {p.select ? null : (
            <ButtonLink href={libraryUrl({ ...p, select: true, clip: null, focus: null })} variant="outline">
              Select
            </ButtonLink>
          )}
        </div>
      </div>

      {page.clips.length === 0 ? (
        <div className="rounded-ds-lg border border-ds-line bg-ds-card">
          {filtered ? (
            <EmptyState
              icon="search"
              title="No clips match"
              body="Try part of a clip name or another topic."
              action={
                <ButtonLink href={libraryUrl({ status: p.status })} variant="outline" size="sm">
                  Clear the filters
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              icon="film"
              title={empty.title}
              body={empty.body}
              action={
                p.status === "all" ? (
                  <ButtonLink href="/calendar" variant="outline" size="sm">
                    Open the calendar
                  </ButtonLink>
                ) : (
                  <ButtonLink href={libraryUrl({ status: "all" })} variant="outline" size="sm">
                    Show all clips
                  </ButtonLink>
                )
              }
            />
          )}
        </div>
      ) : (
        <>
          {p.select ? (
            <SelectShell folders={folders.map((f) => f.folder)} canMove={foldersOn} back={back} doneHref={back}>
              {list}
            </SelectShell>
          ) : (
            list
          )}
          {page.nextCursor || p.cursor ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2 lg:mt-6">
              {p.cursor ? (
                <ButtonLink href={more(null)} variant="ghost">
                  Back to the start
                </ButtonLink>
              ) : null}
              {page.nextCursor ? (
                <ButtonLink href={more(page.nextCursor)} variant="outline">
                  Show more
                </ButtonLink>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {focusId && !open ? <FocusScroll targetId={`clip-${focusId}`} /> : null}
      {open ? <ClipDialog clip={open} touch={touch} uses={uses} folders={foldersOn ? folders.map((f) => f.folder) : null} closeHref={libraryUrl({ ...p, clip: null })} back={libraryUrl(p)} /> : null}
    </AppFrame>
  );
}
