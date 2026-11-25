import Link from "next/link";
import type { LibraryClip, TouchUpClip } from "../../lib/library/data.js";
import { cardStage, durationText, scheduledLong, type ClipUseLine } from "../../lib/library/screen.js";
import { moveFolderForm } from "../../app/library/form-actions.js";
import { Button, ButtonLink, Chip, Input, Select, cx, Dialog, FOCUS, Icon } from "../ui/index.js";
import { ClipVideo } from "./ClipVideo.js";
import { FixState, IssueList } from "./TouchUp.js";

/**
 * `?clip=<id>`: the clip at a larger size with its facts, where it's scheduled, its tags and any open
 * Touch-up issue with "Fix it" (or the fix's current state). Closing returns to the grid URL.
 */
export function ClipDialog({
  clip,
  touch,
  uses = [],
  folders = [],
  closeHref,
  back,
}: {
  clip: LibraryClip;
  touch: TouchUpClip | null;
  /** The next few calendar items using it (clipUseLines), listed under the count. */
  uses?: readonly ClipUseLine[];
  /** Folder labels already in use (loadFolders), for "Move to folder…". */
  /** null = folders unavailable (migration 0016 not applied): the Move section is hidden. */
  folders?: readonly string[] | null;
  closeHref: string;
  back: string;
}) {
  const more = clip.usedIn - uses.length;
  const facts: Array<{ label: string; value: string }> = [
    { label: "Length", value: durationText(clip.durationS) ?? "–" },
    { label: "Topic", value: clip.pillar ? clip.pillar.charAt(0).toUpperCase() + clip.pillar.slice(1) : "None" },
  ];
  if (clip.derivedFrom) facts.push({ label: "Made by", value: "Touch-up (the original is kept)" });
  const stage = touch ? cardStage(touch) : null;
  return (
    <Dialog
      open
      closeHref={closeHref}
      title={clip.label}
      size="lg"
      footer={
        <>
          {stage === "fix" ? null : touch ? (
            <ButtonLink href="/library/touch-up" variant="outline">
              Open Touch-up
            </ButtonLink>
          ) : null}
          {/* F20 E: one clip + a sound → a vertical reel → a draft Instagram post. */}
          <ButtonLink href={`/library/reels?clip=${clip.mediaId}`} variant="outline">
            Make a reel
          </ButtonLink>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-4 sm:gap-5">
          <ClipVideo mediaId={clip.mediaId} hasPoster={clip.hasPoster} label={clip.label} duration={durationText(clip.durationS)} />
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {facts.map((f) => (
                <div key={f.label} className={cx("min-w-0", f.label === "Made by" && "col-span-2")}>
                  <dt className="ds-label text-ds-muted">{f.label}</dt>
                  <dd className="ds-num mt-0.5 text-[15px] font-semibold text-ds-text">{f.value}</dd>
                </div>
              ))}
              <div className="col-span-2 min-w-0">
                <dt className="ds-label text-ds-muted">Where it&rsquo;s used</dt>
                <dd className="mt-0.5">
                  {clip.usedIn > 0 ? (
                    <Link
                      href="/calendar"
                      className={cx("-mx-1 inline-flex min-h-11 items-center gap-1.5 rounded-ds-sm px-1 text-[15px] font-semibold text-ds-accent-fg hover:bg-ds-raised lg:min-h-8", FOCUS)}
                    >
                      <Icon name="calendar" size={16} />
                      <span className="ds-num">{scheduledLong(clip.usedIn)}</span>
                      <Icon name="chevronRight" size={16} />
                    </Link>
                  ) : (
                    <span className="text-[15px] text-ds-text">{scheduledLong(0)}</span>
                  )}
                </dd>
              </div>
              {clip.tags.length ? (
                <div className="col-span-2 min-w-0">
                  <dt className="ds-label text-ds-muted">Tags</dt>
                  <dd className="mt-1.5 flex flex-wrap gap-1.5">
                    {clip.tags.map((t) => (
                      <Chip key={t.code}>{t.label}</Chip>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
        {uses.length ? (
          <ul aria-label="Scheduled posts" className="-mt-2 flex flex-col divide-y divide-ds-line border-y border-ds-line">
            {uses.map((u) => (
              <li key={u.key} className="min-w-0">
                <Link
                  href={u.href}
                  className={cx("flex min-h-11 min-w-0 items-center justify-between gap-2 px-1 py-2 text-[14px] text-ds-text hover:bg-ds-raised", FOCUS)}
                >
                  <span className="ds-num min-w-0">{u.text}</span>
                  <Icon name="chevronRight" size={16} className="shrink-0 text-ds-muted" />
                </Link>
              </li>
            ))}
            {more > 0 ? <li className="ds-helper px-1 py-2">and {more} more in the calendar</li> : null}
          </ul>
        ) : null}
        {folders ? (
        <details className="rounded-ds-md border border-ds-line">
          <summary className={cx("flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-[15px] font-semibold text-ds-text [&::-webkit-details-marker]:hidden", FOCUS)}>
            <span>Move to folder…</span>
            <span className="ds-helper font-normal">{clip.folder ?? "No folder (grouped by week)"}</span>
          </summary>
          <form action={moveFolderForm} className="flex flex-col gap-3 border-t border-ds-line p-3">
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="mediaId" value={clip.mediaId} />
            <Select label="Existing folder" name="existing" defaultValue={clip.folder ?? ""}>
              <option value="">No folder (group by week)</option>
              {(clip.folder && !folders.includes(clip.folder) ? [clip.folder, ...folders] : folders).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
            <Input label="Or a new folder" name="folder" maxLength={60} autoComplete="off" placeholder="e.g. Upper body" helper="A typed name wins. Up to 60 characters, no slashes." />
            <Button type="submit" variant="outline" size="sm" className="self-start">
              Move
            </Button>
          </form>
        </details>
        ) : null}
        {touch ? (
          <section aria-labelledby="clip-touchup" className="flex flex-col gap-3 rounded-ds-md border border-ds-line p-3">
            <h3 id="clip-touchup" className="text-[15px] font-semibold text-ds-text">
              Needs a touch-up
            </h3>
            <IssueList clip={touch} back={back} dismiss={false} />
            <FixState clip={touch} back={back} refreshHref={back} solidFix />
          </section>
        ) : clip.flagged === 0 ? (
          <p className="flex items-center gap-2 text-[14px] text-ds-muted">
            <Icon name="check" size={16} className="shrink-0 text-ds-accent-fg" />
            Nothing to fix on this clip.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
