import Link from "next/link";
import type { LibraryClip } from "../../lib/library/data.js";
import { cardTags, clipAriaLabel, durationText, scheduledShort } from "../../lib/library/screen.js";
import { Chip, cx, FOCUS, Icon, Thumb } from "../ui/index.js";

/**
 * One clip in the Library grid: the 9:16 poster (length on it), the label on one line, "Scheduled 2×" when
 * a post uses it, and up to two quiet tags. The whole card is a link that opens the clip Dialog (`?clip=`).
 * `focused` (from `?focus=`) rings it in the accent; the page scrolls it into view.
 */
export function ClipTile({ clip, href }: { clip: LibraryClip; href: string }) {
  const tags = cardTags(clip);
  const scheduled = scheduledShort(clip.usedIn);
  return (
    <Link
      id={`clip-${clip.mediaId}`}
      href={href}
      scroll={false}
      aria-label={clipAriaLabel(clip)}
      aria-current={clip.focused ? "true" : undefined}
      className={cx(
        "flex h-full min-w-0 flex-col gap-2 rounded-ds-lg border bg-ds-card p-2 transition-colors duration-[var(--ds-dur)] ease-ds hover:bg-ds-raised lg:p-2.5",
        clip.focused ? "border-ds-accent ring-2 ring-ds-accent" : "border-ds-line",
        FOCUS,
      )}
    >
      <Thumb mediaId={clip.hasPoster ? clip.mediaId : null} alt={`${clip.label} poster`} duration={durationText(clip.durationS)} className="w-full" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 px-0.5 pb-0.5">
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold leading-tight text-ds-text">{clip.label}</span>
        {scheduled ? (
          <span className="ds-num flex items-center gap-1 text-[13px] leading-tight text-ds-muted">
            <Icon name="calendar" size={14} className="shrink-0" />
            {scheduled}
          </span>
        ) : null}
        {tags.length ? (
          <span className="mt-auto flex min-w-0 flex-wrap gap-1 pt-0.5">
            {tags.map((t) => (
              <Chip key={t.code} size="sm" tone={t.code === "flagged" ? "warn" : "neutral"} className={t.code === "flagged" ? undefined : "text-ds-muted"}>
                {t.label}
              </Chip>
            ))}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
