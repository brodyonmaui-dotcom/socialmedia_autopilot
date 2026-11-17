import type { ReactNode } from "react";
import type { Platform } from "@autopilot/core";
import { approveAllAction, editTextAction, moveAction, moveTomorrowAction, rejectItemsAction } from "../../app/calendar/actions.js";
import { dayTitle, type Entry } from "../../lib/calendar/model.js";
import { Button, ButtonLink, Chip, cx, Dialog, EmptyState, FIELD, FOCUS, Input, PLATFORM_NAME, PlatformLogo } from "../ui/index.js";
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
export function MoveDialog({ entry, closeHref, back, tomorrow }: { entry: Entry; closeHref: string; back: string; tomorrow: string | null }) {
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
          {entry.title}: {movable.map((p) => `${PLATFORM_NAME[p.platform]} ${p.time ?? "no time"}`).join(", ")}. The new time is checked against your daily limits; a moved post needs approving again.
        </p>
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

/** `?approve=all`: counts per platform, and anything that will stay (with why). */
export function ApproveAllDialog({
  closeHref,
  back,
  items,
  will,
  stays,
}: {
  closeHref: string;
  back: string;
  items: string[];
  will: Partial<Record<Platform, number>>;
  stays: Array<{ platform: Platform; title: string; reason: string }>;
}) {
  const total = Object.values(will).reduce((a, n) => a + (n ?? 0), 0);
  return (
    <Dialog
      open
      closeHref={closeHref}
      title={total ? `Approve ${total === 1 ? "1 post" : `${total} posts`}?` : "Nothing to approve"}
      footer={
        <>
          <Cancel href={closeHref} />
          {total ? (
            <form action={approveAllAction}>
              <Hidden back={back} items={items} />
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
          <ul className="flex flex-col divide-y divide-ds-line" aria-label="Will be approved">
            {(Object.entries(will) as Array<[Platform, number]>).map(([p, n]) => (
              <li key={p} className="flex items-center gap-2 py-2 text-[15px]">
                <PlatformLogo platform={p} size={16} />
                {PLATFORM_NAME[p]}
                <span className="ds-num ml-auto font-semibold">{n}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {stays.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-[14px] font-semibold text-ds-text">{stays.length === 1 ? "1 stays as it is" : `${stays.length} stay as they are`}</p>
            <ul className="flex flex-col gap-1.5">
              {stays.slice(0, 8).map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-[14px] text-ds-muted">
                  <PlatformLogo platform={s.platform} size={14} className="mt-0.5 shrink-0 text-ds-text" />
                  <span>
                    <span className="text-ds-text">{s.title}</span>: {s.reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-[13px] text-ds-muted">Approved posts go out at their own times. Nothing is posted early.</p>
      </div>
    </Dialog>
  );
}
