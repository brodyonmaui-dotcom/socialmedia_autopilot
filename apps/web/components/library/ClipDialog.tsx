import Link from "next/link";
import type { LibraryClip, TouchUpClip } from "../../lib/library/data.js";
import { cardStage, durationText, scheduledLong } from "../../lib/library/screen.js";
import { ButtonLink, Chip, cx, Dialog, FOCUS, Icon, Thumb } from "../ui/index.js";
import { FixState, IssueList } from "./TouchUp.js";

/**
 * `?clip=<id>`: the clip at a larger size with its facts, where it's scheduled, its tags and any open
 * Touch-up issue with "Fix it" (or the fix's current state). Closing returns to the grid URL.
 */
export function ClipDialog({ clip, touch, closeHref, back }: { clip: LibraryClip; touch: TouchUpClip | null; closeHref: string; back: string }) {
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
        stage === "fix" ? undefined : touch ? (
          <ButtonLink href="/library/touch-up" variant="outline">
            Open Touch-up
          </ButtonLink>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-4 sm:gap-5">
          <Thumb mediaId={clip.hasPoster ? clip.mediaId : null} alt={`${clip.label} poster`} duration={durationText(clip.durationS)} className="w-[96px] sm:w-[160px]" />
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
