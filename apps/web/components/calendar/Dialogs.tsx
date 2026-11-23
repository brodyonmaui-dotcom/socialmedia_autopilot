import Link from "next/link";
import type { ReactNode } from "react";
import type { Platform } from "@autopilot/core";
import { approveAllAction, editTextAction, moveAction, moveTomorrowAction, rejectItemsAction, rescheduleMissedAction } from "../../app/calendar/actions.js";
import type { ReschedulePlanRow } from "../../lib/calendar/reschedule.js";
import { NO_SLOT_TEXT, nextSlotView, type NextSlotLine } from "../../lib/calendar/next-slot-view.js";
import { dayTitle, slotText, type ApproveAllView, type Entry } from "../../lib/calendar/model.js";
import { Button, ButtonLink, Chip, cx, Dialog, EmptyState, FIELD, FOCUS, Icon, Input, PLATFORM_NAME, PlatformLogo } from "../ui/index.js";
import { itemField, PostCard, type PostCardLinks } from "./PostCard.js";

const Hidden = ({ back, items }: { back: string; items: string[] }) => (
  <>
    <input type="hidden" name="back" value={back} />
    {items.map((v) => (
      <input key={v} type="hidden" name="item" value={v} />
    ))}
  </>
);

const Cancel = ({ href }: { href: string }) => (
  <ButtonLink href={href} variant="outline">
    Cancel
  </ButtonLink>
);

/** `?day=YYYY-MM-DD`: the date as the title, one PostCard per clip (platforms grouped), by first time. */
export function DayDialog({ day, entries, closeHref, back, links, draftsFirst, emptyAction }: { day: string; entries: Entry[]; closeHref: string; back: string; links: PostCardLinks; draftsFirst: boolean; emptyAction?: ReactNode }) {
  return (
    <Dialog open closeHref={closeHref} title={dayTitle(day)} size="lg">
      {entries.length === 0 ? (
        <EmptyState icon="calendar" title="Nothing this day" body="Posts you plan or approve for this day show up here." action={emptyAction} className="py-6" />
      ) : (
        <ol className="flex flex-col gap-2" aria-label={`Posts on ${dayTitle(day)}`}>
          {entries.map((e) => (
            <li key={e.key}>
              <PostCard entry={e} back={back} links={links} emphasise={draftsFirst} />
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}

/** `?edit=<entry>`: per-platform caption (and YouTube title) with the current warnings under each. */
export function EditTextDialog({ entry, closeHref, back }: { entry: Entry; closeHref: string; back: string }) {
  const editable = entry.platforms.filter((p) => p.canEdit);
  const formId = `edit-${entry.mediaId}`;
  const wasApproved = editable.some((p) => p.status !== "draft");
  return (
    <Dialog
      open
      closeHref={closeHref}
      title="Edit text"
      size="lg"
      footer={
        <>
          <Cancel href={closeHref} />
          <Button type="submit" form={formId} variant="solid">
            Save
          </Button>
        </>
      }
    >
      <form id={formId} action={editTextAction} className="flex flex-col gap-5">
        <Hidden back={back} items={editable.map(itemField)} />
        <p className="text-[14px] text-ds-muted">
          {entry.title}
          {wasApproved ? ". Saving puts approved posts back to Needs approval; approve them again after." : "."}
        </p>
        {editable.map((p) => (
          <fieldset key={p.itemId} className="flex flex-col gap-3">
            <legend className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ds-text">
              <PlatformLogo platform={p.platform as Platform} size={16} />
              {PLATFORM_NAME[p.platform]}
            </legend>
            {p.platform === "youtube" ? <Input label="Title" name={`title:${p.itemId}`} defaultValue={p.text.title ?? ""} maxLength={100} /> : null}
            {p.platform !== "snapchat" ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`caption-${p.itemId}`} className="text-[12px] font-semibold text-ds-muted">
                  Caption
                </label>
                <textarea id={`caption-${p.itemId}`} name={`caption:${p.itemId}`} defaultValue={p.text.caption} rows={5} className={cx(FIELD, FOCUS, "min-h-32 py-2.5 leading-normal")} />
              </div>
            ) : (
              <p className="text-[14px] text-ds-muted">Snapchat posts are shared by hand; the caption is typed in the app.</p>
            )}
            {p.warnings.length ? (
              <ul className="flex flex-wrap gap-2" aria-label={`${PLATFORM_NAME[p.platform]} warnings`}>
                {p.warnings.map((w, i) => (
                  <li key={i} className="max-w-full">
                    <Chip wrap tone={w.severity === "block" ? "danger" : "warn"}>
                      {w.message}
                    </Chip>
                  </li>
                ))}
              </ul>
            ) : null}
          </fieldset>
        ))}
      </form>
    </Dialog>
  );
}

/** `?move=<entry>`: Tomorrow (editor drafts: the editor slotting) or a date with an optional new time. */
export function MoveDialog({
  entry,
  closeHref,
  back,
  tomorrow,
  nextSlots = [],
  timeZone = "UTC",
  rescheduleHref,
}: {
  entry: Entry;
  closeHref: string;
  back: string;
  tomorrow: string | null;
  /** One per platform line: the next open slot (computed by the page only while this dialog is open). */
  nextSlots?: NextSlotLine[];
  timeZone?: string;
  /** The existing "Auto-schedule at nearest slot" confirm for one item (keeps approval). */
  rescheduleHref?: (itemId: string) => string;
}) {
  const movable = entry.platforms.filter((p) => p.canEdit);
  const items = movable.map(itemField);
  const formId = `move-${entry.mediaId}`;
  return (
    <Dialog
      open
      closeHref={closeHref}
      title="Move"
      footer={
        <>
          <Cancel href={closeHref} />
          <Button type="submit" form={formId} variant="solid">
            Move
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-[14px] text-ds-muted">
          {entry.title}: {movable.map((p) => `${PLATFORM_NAME[p.platform]} ${p.time12 ?? "no time"}`).join(", ")}. The new time is checked against your daily limits; a moved post needs approving again.
        </p>
        {nextSlots.length ? (
          <div className="flex flex-col gap-2">
            {nextSlots.map((line) => {
              const v = nextSlotView(line, timeZone);
              const name = PLATFORM_NAME[line.platform as Platform] ?? line.platform;
              return v.text && v.date && v.time ? (
                <form key={line.itemId} action={moveAction}>
                  <Hidden back={back} items={[line.field]} />
                  <input type="hidden" name="date" value={v.date} />
                  <input type="hidden" name="time" value={v.time} />
                  <Button type="submit" variant="outline" block>
                    <PlatformLogo platform={line.platform as Platform} size={16} />
                    Next open {name} slot: <span className="ds-num">{v.text}</span>
                  </Button>
                </form>
              ) : (
                <p key={line.itemId} className="flex min-h-11 items-center gap-2 text-[14px] text-ds-muted">
                  <PlatformLogo platform={line.platform as Platform} size={16} className="text-ds-text" />
                  {name}: {NO_SLOT_TEXT}
                </p>
              );
            })}
          </div>
        ) : null}
        {rescheduleHref
          ? movable
              .filter((p) => p.missed)
              .map((p) => (
                <p key={p.itemId} className="text-[13px] text-ds-muted">
                  {PLATFORM_NAME[p.platform]} missed its time.{" "}
                  <Link href={rescheduleHref(p.itemId)} className={cx("inline-flex min-h-11 items-center font-semibold text-ds-accent-fg underline", FOCUS)}>
                    Auto-schedule at nearest slot
                  </Link>{" "}
                  keeps it approved.
                </p>
              ))
          : null}
        {tomorrow && entry.fromEditor ? (
          <form action={moveTomorrowAction}>
            <Hidden back={back} items={items} />
            <Button type="submit" variant="outline" block>
              Tomorrow, at the next free times
            </Button>
          </form>
        ) : null}
        <form id={formId} action={moveAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Hidden back={back} items={items} />
          <Input label="Date" name="date" type="date" required defaultValue={entry.day ?? tomorrow ?? ""} />
          <Input label="Time (optional)" name="time" type="time" helper="Empty keeps each post's own time." />
        </form>
      </div>
    </Dialog>
  );
}

/** `?reject=<entry>`: confirm. Rows stay (Show rejected). */
export function RejectDialog({ entry, closeHref, back }: { entry: Entry; closeHref: string; back: string }) {
  const items = entry.platforms.filter((p) => p.canEdit);
  return (
    <Dialog
      open
      closeHref={closeHref}
      title="Reject this post?"
      footer={
        <>
          <Cancel href={closeHref} />
          <form action={rejectItemsAction}>
            <Hidden back={back} items={items.map(itemField)} />
            <Button type="submit" variant="solid" block>
              Reject {items.length === 1 ? "1 post" : `${items.length} posts`}
            </Button>
          </form>
        </>
      }
    >
      <p className="text-[15px] text-ds-text">
        {entry.title} won&rsquo;t go out on {items.map((p) => PLATFORM_NAME[p.platform]).join(", ")}. Nothing is deleted: it stays under &ldquo;Show rejected&rdquo;.
      </p>
    </Dialog>
  );
}

const DETAILS = "group border-b border-ds-line";
const SUMMARY = cx("flex min-h-11 cursor-pointer list-none items-center gap-2 text-[15px] [&::-webkit-details-marker]:hidden", FOCUS);

/**
 * `?approve=all`: "Approve N posts", one collapsible group per platform listing each post (title, day + time),
 * and a separate collapsed "Not included" list (needs a fix first) that is not part of N. N and the ids come
 * from the same line states as the card chips (approveAllView).
 */
export function ApproveAllDialog({ closeHref, back, view }: { closeHref: string; back: string; view: ApproveAllView }) {
  const { total, groups, notIncluded } = view;
  return (
    <Dialog
      open
      closeHref={closeHref}
      title={total ? `Approve ${total === 1 ? "1 post" : `${total} posts`}` : "Nothing to approve"}
      footer={
        <>
          <Cancel href={closeHref} />
          {total ? (
            <form action={approveAllAction}>
              <Hidden back={back} items={groups.flatMap((g) => g.lines.map((l) => l.field))} />
              <Button type="submit" variant="solid" block>
                Approve {total}
              </Button>
            </form>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {total ? (
          <div className="flex flex-col border-t border-ds-line">
            {groups.map((g) => (
              <details key={g.platform} className={DETAILS}>
                <summary className={SUMMARY}>
                  <PlatformLogo platform={g.platform} size={16} />
                  <span>
                    {PLATFORM_NAME[g.platform]} · <span className="ds-num">{g.lines.length}</span>
                  </span>
                  <Icon name="chevronDown" size={16} className="ml-auto text-ds-muted transition-transform duration-300 ease-ds group-open:rotate-180" />
                </summary>
                <ul className="flex flex-col gap-2 pb-3 pl-6">
                  {g.lines.map((l) => (
                    <li key={l.itemId} className="flex flex-col text-[14px] leading-snug">
                      <span className="text-ds-text">{l.title}</span>
                      <span className="ds-num text-ds-muted">{l.when}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        ) : (
          <p className="text-[15px] text-ds-muted">Every draft in view needs a fix first, or there are none.</p>
        )}
        {total ? <p className="text-[13px] text-ds-muted">They&rsquo;ll post at these times. You can still move or reject them.</p> : null}
        {notIncluded.length ? (
          <details className="border-t border-ds-line">
            <summary className={cx(SUMMARY, "text-ds-muted")}>Not included: needs a fix first ({notIncluded.length})</summary>
            <ul className="flex flex-col gap-1.5 pb-2">
              {notIncluded.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-[14px] text-ds-muted">
                  <PlatformLogo platform={s.platform} size={14} className="mt-0.5 shrink-0 text-ds-text" />
                  <span>
                    <span className="text-ds-text">{s.title}</span>: {s.reason}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * `?reschedule=<id>` / `?reschedule=all`: confirm moving missed posts to the nearest free slot. The times shown
 * come from previewRescheduleMissed; the tap on the button is the approval of those times. Posts stay approved.
 */
export function RescheduleDialog({ closeHref, back, rows, timeZone, single }: { closeHref: string; back: string; rows: ReschedulePlanRow[]; timeZone: string; single: boolean }) {
  const ready = rows.filter((r) => r.to != null);
  const stuck = rows.filter((r) => r.to == null);
  const one = single ? rows[0] : undefined;
  const title = single ? (ready.length ? "Auto-schedule at nearest slot" : "No slot to offer") : ready.length ? `Reschedule ${ready.length === 1 ? "1 missed post" : `${ready.length} missed posts`}` : "Nothing to reschedule";
  const label = (r: ReschedulePlanRow) => (r.series ? `Series · Day ${r.series.day}` : null);
  return (
    <Dialog
      open
      closeHref={closeHref}
      title={title}
      footer={
        <>
          <Cancel href={closeHref} />
          {ready.length ? (
            <form action={rescheduleMissedAction}>
              <input type="hidden" name="returnTo" value={back} />
              {ready.map((r) => (
                <input key={r.id} type="hidden" name="itemId" value={r.id} />
              ))}
              <Button type="submit" variant="solid" block>
                {single ? "Reschedule" : `Reschedule ${ready.length}`}
              </Button>
            </form>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {one && one.to ? (
          <p className="text-[15px] text-ds-text">
            Post at <strong className="font-semibold">{slotText(one.to, timeZone)}</strong>? It stays approved.
          </p>
        ) : null}
        <ul className="flex flex-col divide-y divide-ds-line border-y border-ds-line" aria-label="Missed posts">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-0.5 py-2.5 text-[14px]">
              <span className="flex items-center gap-2 text-ds-text">
                <PlatformLogo platform={r.platform} size={14} />
                {label(r) ? <span className="ds-caps text-ds-muted">{label(r)}</span> : null}
                <span className="min-w-0 truncate">{r.title}</span>
              </span>
              <span className="ds-num text-ds-muted">
                {slotText(r.from, timeZone)} {"→ "}
                {r.to ? <span className="text-ds-text">{slotText(r.to, timeZone)}</span> : <span>{r.reason === "no-slot" ? "no free slot this week" : "not missed any more"}</span>}
              </span>
            </li>
          ))}
        </ul>
        {stuck.length && ready.length ? <p className="text-[13px] text-ds-muted">{stuck.length === 1 ? "1 post has no free slot" : `${stuck.length} posts have no free slot`} and stays as it is.</p> : null}
        <p className="text-[13px] text-ds-muted">Posts stay approved and go out at the new time. Nothing is posted early.</p>
      </div>
    </Dialog>
  );
}
