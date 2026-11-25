import Link from "next/link";
import type { LibraryClip } from "../../lib/library/data.js";
import { MARK_PLATFORMS } from "../../lib/library/data.js";
import { cardTags, clipAriaLabel, durationText, markText, scheduledShort } from "../../lib/library/screen.js";
import { PLATFORM_NAME } from "../../lib/platforms/view.js";
import { CHOICE_BOX, Chip, cx, FOCUS, Icon, PlatformLogo, Thumb } from "../ui/index.js";

const CARD = "flex h-full min-w-0 flex-col gap-2 rounded-ds-lg border bg-ds-card p-2 transition-colors duration-[var(--ds-dur)] ease-ds hover:bg-ds-raised lg:p-2.5";

/** Per-platform marks: a logo and "Posted" or the day + 12-hour time. Platforms with nothing show nothing. */
function Marks({ clip, timeZone }: { clip: LibraryClip; timeZone: string }) {
  const shown = MARK_PLATFORMS.filter((p) => clip.marks[p]);
  if (shown.length === 0) return null;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {shown.map((p) => {
        const m = clip.marks[p]!;
        return (
          <span key={p} className="ds-num flex min-w-0 items-center gap-1.5 text-[12px] leading-tight text-ds-muted">
            <PlatformLogo platform={p} size={14} title={PLATFORM_NAME[p]} className="shrink-0" />
            {m.kind === "posted" ? <Icon name="check" size={14} className="shrink-0 text-ds-accent-fg" /> : null}
            <span className="min-w-0">{markText(m, timeZone)}</span>
          </span>
        );
      })}
    </span>
  );
}

function Body({ clip, timeZone, poster }: { clip: LibraryClip; timeZone: string; poster: React.ReactNode }) {
  const tags = cardTags(clip);
  const scheduled = scheduledShort(clip.usedIn);
  return (
    <>
      {poster}
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 px-0.5 pb-0.5">
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold leading-tight text-ds-text">{clip.label}</span>
        <Marks clip={clip} timeZone={timeZone} />
        {scheduled && Object.keys(clip.marks).length === 0 ? (
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
    </>
  );
}

/**
 * One clip in the Library grid: the 9:16 poster (length on it), the label on one line, small per-platform marks
 * (posted check, or day + time), and up to two quiet tags. The whole card is a link that opens the clip Dialog (`?clip=`),
 * or, in select mode, a label around a checkbox (`name="pick"`, read by the select bar). `focused` (from `?focus=`) rings it.
 */
export function ClipTile({ clip, href, timeZone, selectable = false }: { clip: LibraryClip; href: string; timeZone: string; selectable?: boolean }) {
  const thumb = <Thumb mediaId={clip.hasPoster ? clip.mediaId : null} alt={`${clip.label} poster`} duration={durationText(clip.durationS)} className="w-full" />;
  if (selectable) {
    return (
      <label
        id={`clip-${clip.mediaId}`}
        className={cx(CARD, "relative cursor-pointer border-ds-line has-[input:checked]:border-ds-accent has-[input:checked]:ring-2 has-[input:checked]:ring-ds-accent")}
      >
        <Body
          clip={clip}
          timeZone={timeZone}
          poster={
            <span className="relative block">
              {thumb}
              <span className="absolute left-1.5 top-1.5 inline-flex size-[22px]">
                <input type="checkbox" name="pick" value={clip.mediaId} aria-label={`Select ${clip.label}`} className={CHOICE_BOX} />
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="pointer-events-none absolute inset-0 m-auto size-4 text-ds-on-invert opacity-0 peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth={3}>
                  <path d="M5 12.5 10 17 19 7" />
                </svg>
              </span>
            </span>
          }
        />
      </label>
    );
  }
  return (
    <Link
      id={`clip-${clip.mediaId}`}
      href={href}
      scroll={false}
      aria-label={clipAriaLabel(clip)}
      aria-current={clip.focused ? "true" : undefined}
      className={cx(CARD, "hover:bg-ds-raised", clip.focused ? "border-ds-accent ring-2 ring-ds-accent" : "border-ds-line", FOCUS)}
    >
      <Body clip={clip} timeZone={timeZone} poster={thumb} />
    </Link>
  );
}
