import Link from "next/link";
import { dayTitle, WEEKDAYS, type DayCell } from "../../lib/calendar/model.js";
import { Badge, cx, FOCUS, PlatformLogo } from "../ui/index.js";
import { PostCard, type PostCardLinks } from "./PostCard.js";

const TONE = { neutral: "neutral", accent: "accent", warn: "warn", danger: "danger" } as const;

/**
 * The week view. Desktop (≥ lg): seven columns of compact entries, each linking to its Day Dialog.
 * Phone: a vertical agenda grouped by day, with full PostCards (empty days collapse to one line).
 */
export function WeekView({
  days,
  hrefFor,
  back,
  links,
  draftsOnly = false,
}: {
  days: DayCell[];
  hrefFor: (day: string) => string;
  back: string;
  links: PostCardLinks;
  draftsOnly?: boolean;
}) {
  return (
    <>
      {/* Desktop columns */}
      <ol className="hidden grid-cols-7 gap-2 lg:grid" aria-label="Week">
        {days.map((c, i) => (
          <li key={c.day} className="flex min-w-0 flex-col gap-2">
            <Link
              href={hrefFor(c.day)}
              scroll={false}
              aria-current={c.isToday ? "date" : undefined}
              className={cx("flex items-baseline gap-2 rounded-ds-sm px-1 py-1 hover:bg-ds-raised", FOCUS)}
            >
              <span className={cx("text-[13px] font-semibold", c.isToday ? "text-ds-text" : "text-ds-muted")}>{WEEKDAYS[i]}</span>
              <span className={cx("ds-num inline-flex size-7 items-center justify-center rounded-full text-[14px]", c.isToday ? "font-bold ring-2 ring-ds-text" : "text-ds-text")}>{c.dayNum}</span>
              {c.needsYou ? <span aria-hidden="true" className="size-1.5 rounded-full bg-ds-accent" /> : null}
            </Link>
            {c.entries.length === 0 ? (
              <p className="rounded-ds-sm border border-dashed border-ds-line px-2 py-3 text-center text-[12px] text-ds-muted">Nothing</p>
            ) : (
              c.entries.map((e) => (
                <Link
                  key={e.key}
                  href={hrefFor(c.day)}
                  scroll={false}
                  className={cx(
                    "flex min-w-0 flex-col gap-1.5 rounded-ds-sm border bg-ds-card p-2 hover:bg-ds-raised",
                    draftsOnly && e.status === "needs-you" ? "border-ds-accent" : "border-ds-line",
                    draftsOnly && e.status !== "needs-you" && "opacity-50",
                    FOCUS,
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="ds-num text-[12px] text-ds-muted">{e.firstTime}</span>
                    <span className="ml-auto flex gap-1">
                      {e.platforms.map((p) => (
                        <PlatformLogo key={p.itemId} platform={p.platform} size={12} className="text-ds-text" />
                      ))}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-ds-text">{e.title}</span>
                  <Badge tone={TONE[e.tone]} className="self-start">
                    {e.statusLabel}
                  </Badge>
                </Link>
              ))
            )}
          </li>
        ))}
      </ol>

      {/* Phone agenda */}
      <ol className="flex flex-col gap-4 lg:hidden" aria-label="Week agenda">
        {days.map((c) => (
          <li key={c.day} className="flex flex-col gap-2">
            <h2 className={cx("flex items-center gap-2 text-[15px] font-semibold", c.isToday ? "text-ds-text" : "text-ds-muted")}>
              {dayTitle(c.day)}
              {c.isToday ? <Badge tone="solid">Today</Badge> : null}
            </h2>
            {c.entries.length === 0 ? (
              <p className="text-[14px] text-ds-muted">Nothing scheduled.</p>
            ) : (
              c.entries.map((e) => <PostCard key={e.key} entry={e} back={back} links={links} emphasise={draftsOnly} />)
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
