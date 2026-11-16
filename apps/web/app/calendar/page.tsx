import { localDate } from "@autopilot/core";
import { AppFrame } from "../../components/AppFrame.js";
import {
  ApproveAllDialog,
  DayDialog,
  EditTextDialog,
  itemField,
  MonthGrid,
  MoveDialog,
  PostCard,
  RejectDialog,
  ResetDialog,
  WeekView,
  type PostCardLinks,
} from "../../components/calendar/index.js";
import { Button, ButtonLink, Card, EmptyState, IconLink, InlineNotice, PageHeader, TabLinks, cx } from "../../components/ui/index.js";
import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";
import { creatorZone, loadCalendar } from "../../lib/calendar/load.js";
import {
  calendarHref,
  dayEntries,
  dayTitle,
  monthMatrix,
  monthTitle,
  parseCalendarState,
  stepAnchor,
  viewRange,
  weekCells,
  weekTitle,
} from "../../lib/calendar/model.js";
import { approveAllSummary, tomorrowOf } from "../../lib/calendar/plan.js";
import { fillTimesAction } from "./actions.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar · My Socials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);

/**
 * Calendar (replaces Batches): month / week views, the Day Dialog, and every post action through the
 * existing planTransition gates. All state is in the URL (?view, ?d, ?day, ?edit, ?move, ?reject, ?reset,
 * ?approve=all, ?status=draft, ?rejected=1), so every state is linkable and navigation works without JS.
 */
export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const now = new Date();
  const zone = creatorZone();
  const today = localDate(now, zone.timeZone);
  const state = parseCalendarState(sp, today);
  const range = viewRange(state.view, state.d);
  const data = await loadCalendar(getPool(), { from: range.from, to: range.to, now, showRejected: state.showRejected });
  const entries = data.entries.filter((e) => e.day! >= range.from && e.day! <= range.to);

  const here = calendarHref(state);
  const back = calendarHref(state, { day: state.day });
  const links: PostCardLinks = {
    edit: (key) => calendarHref(state, { day: state.day, edit: key }),
    move: (key) => calendarHref(state, { day: state.day, move: key }),
    reject: (key) => calendarHref(state, { day: state.day, reject: key }),
    reset: (itemId) => calendarHref(state, { day: state.day, reset: itemId }),
    handoff: "/handoff",
  };
  const dayHref = (day: string) => calendarHref(state, { day });
  const closeToDay = state.day ? calendarHref(state, { day: state.day }) : here;

  const draftIds = entries.flatMap((e) => e.platforms.filter((p) => p.status === "draft")).map(itemField);
  const draftCount = draftIds.length;
  const all = [...data.entries, ...data.untimed];
  const find = (key: string | null) => (key ? all.find((e) => e.key === key) ?? null : null);
  const editEntry = find(state.edit);
  const moveEntry = find(state.move);
  const rejectEntry = find(state.reject);
  const resetItem = state.reset ? all.flatMap((e) => e.platforms.map((p) => ({ e, p }))).find((x) => x.p.itemId === state.reset) ?? null : null;
  const summary = state.approveAll ? approveAllSummary(data.batches, new Set(draftIds.map((v) => v.split(":")[1]!)), now) : null;

  const title = state.view === "week" ? weekTitle(state.d) : monthTitle(state.d);
  const error = param(sp.error);
  const note = param(sp.note);

  return (
    <AppFrame active="calendar">
      <PageHeader
        title="Calendar"
        subtitle={state.drafts ? "Showing what needs your approval" : undefined}
        action={
          draftCount > 0 ? (
            <ButtonLink href={calendarHref(state, { approveAll: true })} variant="solid">
              Approve all {draftCount}
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 lg:gap-4">
        {zone.source === "fallback" ? (
          <InlineNotice tone="warn" href="/settings" linkLabel="Settings">
            Times are shown in UTC because your time zone isn&rsquo;t set yet.
          </InlineNotice>
        ) : null}
        {error ? (
          <InlineNotice tone="danger" live>
            {error}
          </InlineNotice>
        ) : note ? (
          <InlineNotice live>{note}</InlineNotice>
        ) : null}

        {/* Toolbar: period title, prev / today / next, month | week, filters */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="ds-heading mr-auto min-w-0">{title}</h2>
          <div className="flex items-center gap-1">
            <IconLink href={calendarHref(state, { d: stepAnchor(state.view, state.d, -1) })} icon="chevronLeft" label={state.view === "week" ? "Previous week" : "Previous month"} />
            <ButtonLink href={calendarHref(state, { d: today })} variant="outline" size="sm">
              Today
            </ButtonLink>
            <IconLink href={calendarHref(state, { d: stepAnchor(state.view, state.d, 1) })} icon="chevronRight" label={state.view === "week" ? "Next week" : "Next month"} />
          </div>
          <div className="w-40">
            <TabLinks
              ariaLabel="View"
              items={[
                { href: calendarHref(state, { view: "month" }), label: "Month", active: state.view === "month" },
                { href: calendarHref(state, { view: "week" }), label: "Week", active: state.view === "week" },
              ]}
            />
          </div>
        </div>
        <div className="-mt-1 flex flex-wrap gap-x-1 gap-y-1">
          <ButtonLink href={calendarHref(state, { drafts: !state.drafts })} variant="ghost" size="sm" aria-pressed={state.drafts} className={cx(state.drafts && "bg-ds-raised")}>
            Needs approval only
          </ButtonLink>
          <ButtonLink href={calendarHref(state, { showRejected: !state.showRejected })} variant="ghost" size="sm" aria-pressed={state.showRejected} className={cx(state.showRejected && "bg-ds-raised")}>
            Show rejected
          </ButtonLink>
        </div>

        {entries.length === 0 && data.untimed.length === 0 ? (
          <Card>
            <EmptyState
              icon="calendar"
              title="Nothing scheduled yet"
              body="Drop renders into the editor folder or plan the week."
              action={
                <ButtonLink href="/library" variant="outline" size="sm">
                  Open the library
                </ButtonLink>
              }
            />
          </Card>
        ) : state.view === "week" ? (
          <WeekView days={weekCells(state.d, today, entries)} hrefFor={dayHref} back={here} links={links} draftsOnly={state.drafts} />
        ) : (
          <MonthGrid weeks={monthMatrix(state.d, today, entries)} hrefFor={dayHref} draftsOnly={state.drafts} label={title} />
        )}

        {data.untimed.length ? (
          <Card
            title="No time yet"
            subtitle="Drafts without a time can't be approved."
            action={
              <form action={fillTimesAction}>
                <input type="hidden" name="back" value={here} />
                {[...new Set(data.untimed.flatMap((e) => e.platforms.map((p) => p.batchId)))].map((b) => (
                  <input key={b} type="hidden" name="batch" value={b} />
                ))}
                <Button type="submit" variant="outline" size="sm">
                  Fill times
                </Button>
              </form>
            }
          >
            <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {data.untimed.map((e) => (
                <li key={e.key}>
                  <PostCard entry={e} back={here} links={links} />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      {state.day ? (
        <DayDialog
          day={state.day}
          entries={dayEntries(data.entries, state.day, state.drafts)}
          closeHref={here}
          back={back}
          links={links}
          draftsFirst={state.drafts}
          emptyAction={
            <ButtonLink href="/library" variant="outline" size="sm">
              Open the library
            </ButtonLink>
          }
        />
      ) : null}
      {editEntry ? <EditTextDialog entry={editEntry} closeHref={closeToDay} back={closeToDay} /> : null}
      {moveEntry ? <MoveDialog entry={moveEntry} closeHref={closeToDay} back={closeToDay} tomorrow={data.timeZoneSource === "env" ? tomorrowOf(now, data.timeZone) : null} /> : null}
      {rejectEntry ? <RejectDialog entry={rejectEntry} closeHref={closeToDay} back={closeToDay} /> : null}
      {resetItem ? (
        <ResetDialog
          batchId={resetItem.p.batchId}
          itemId={resetItem.p.itemId}
          platform={resetItem.p.platform}
          statusLabel={resetItem.p.statusLabel}
          attempts={resetItem.p.attempts}
          lastError={resetItem.p.lastError}
          scheduled={resetItem.e.day ? `${dayTitle(resetItem.e.day)} · ${resetItem.p.time ?? ""}` : "No time"}
          keyTail={resetItem.p.keyTail}
          canReset={resetItem.p.canReset}
          canRecord={resetItem.p.canRecord}
          back={closeToDay}
          closeHref={closeToDay}
        />
      ) : null}
      {summary ? <ApproveAllDialog closeHref={here} back={here} items={draftIds} will={summary.will} stays={summary.stays} /> : null}
    </AppFrame>
  );
}
