import Link from "next/link";
import { clock12FromHHMM, type Platform } from "@autopilot/core";
import { WEEKDAYS, type DayCell, type Entry } from "../../lib/calendar/model.js";
import { cx, FOCUS, PLATFORM_NAME, PlatformLogo } from "../ui/index.js";

const SERIES_DOT: Record<Platform, string> = {
  instagram: "bg-ds-series-instagram",
  youtube: "bg-ds-series-youtube",
  tiktok: "bg-ds-series-tiktok",
  snapchat: "bg-ds-series-snapchat",
};
const STATUS_DOT: Record<Entry["status"], string> = {
  "needs-you": "bg-ds-accent",
  attention: "bg-ds-warn",
  approved: "bg-ds-text",
  published: "bg-ds-line-strong",
  rejected: "bg-ds-line",
};

function cellLabel(c: DayCell): string {
  const n = c.count;
  return `${c.day}${c.isToday ? ", today" : ""}: ${n === 0 ? "nothing scheduled" : n === 1 ? "1 post" : `${n} posts`}${c.needsYou ? ", something needs you" : ""}`;
}

/** One entry as a one-line pill (desktop cells): status dot, first platform glyph, time, title. */
function Pill({ e, dim }: { e: Entry; dim: boolean }) {
  const first = e.platforms[0]!;
  return (
    <li className={cx("flex min-w-0 items-center gap-1 rounded-ds-xs bg-ds-raised px-1.5 py-[3px] text-[12px] leading-tight text-ds-text", dim && "opacity-50")}>
      <span aria-hidden="true" className={cx("size-1.5 shrink-0 rounded-full", STATUS_DOT[e.status])} />
      <PlatformLogo platform={first.platform} size={12} className="shrink-0" />
      {e.firstTime ? <span className="ds-num shrink-0 text-ds-muted">{clock12FromHHMM(e.firstTime)}</span> : null}
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{e.title}</span>
    </li>
  );
}

/**
 * The month view: a 7-column grid of day cells inside one card; cells are split only by the card's own
 * hairlines. Desktop: day number + up to three one-line entries, then "+N more". Phone: the number, up to
 * four platform dots and a count. Every cell links to its Day Dialog. Outside-month days are muted, today
 * has an ink ring, a day needing him has an accent dot. `draftsOnly` (`?status=draft`) fades the rest.
 */
export function MonthGrid({ weeks, hrefFor, draftsOnly = false, label }: { weeks: DayCell[][]; hrefFor: (day: string) => string; draftsOnly?: boolean; label: string }) {
  return (
    <section aria-label={label} className="overflow-hidden rounded-ds-lg border border-ds-line bg-ds-card">
      <div className="grid grid-cols-7" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-1.5 py-2 text-center text-[12px] font-semibold text-ds-muted lg:px-2 lg:text-left">
            <span className="lg:hidden">{d[0]}</span>
            <span className="hidden lg:inline">{d}</span>
          </div>
        ))}
      </div>
      <ol className="grid grid-cols-7">
        {weeks.flat().map((c, i) => {
          const shown = c.entries.slice(0, 3);
          const more = c.entries.length - shown.length;
          const faded = draftsOnly && !c.hasDrafts;
          return (
            <li key={c.day} className={cx("min-w-0 border-t border-ds-line", i % 7 !== 0 && "border-l")}>
              <Link
                href={hrefFor(c.day)}
                scroll={false}
                aria-label={cellLabel(c)}
                aria-current={c.isToday ? "date" : undefined}
                className={cx(
                  "flex h-full min-h-16 flex-col gap-1 p-1 transition-colors duration-[var(--ds-dur)] hover:bg-ds-raised lg:min-h-[112px] lg:p-2",
                  !c.inMonth && "bg-ds-bg/40 [&>*]:opacity-60",
                  FOCUS,
                  "focus-visible:-outline-offset-2",
                )}
              >
                <span className="flex items-center justify-center gap-1 lg:justify-start">
                  <span
                    className={cx(
                      "ds-num inline-flex size-7 items-center justify-center rounded-full text-[13px]",
                      c.isToday ? "font-bold text-ds-text ring-2 ring-ds-text" : c.inMonth ? "text-ds-text" : "text-ds-muted",
                      faded && "opacity-50",
                    )}
                  >
                    {c.dayNum}
                  </span>
                  {c.needsYou ? <span aria-hidden="true" className="hidden size-1.5 rounded-full bg-ds-accent lg:inline-block" /> : null}
                </span>
                {/* Phone: dots + count */}
                {c.count > 0 ? (
                  <span aria-hidden="true" className={cx("flex flex-col items-center gap-0.5 lg:hidden", faded && "opacity-50")}>
                    <span className="flex gap-0.5">
                      {c.dots.map((p) => (
                        <span key={p} className={cx("size-1.5 rounded-full", SERIES_DOT[p])} title={PLATFORM_NAME[p]} />
                      ))}
                    </span>
                    <span className={cx("ds-num text-[11px] leading-none", c.needsYou ? "font-bold text-ds-accent-fg" : "text-ds-muted")}>{c.count}</span>
                  </span>
                ) : null}
                {/* Desktop: up to three entries, then +N more */}
                {shown.length ? (
                  <ul aria-hidden="true" className="hidden min-w-0 flex-col gap-1 lg:flex">
                    {shown.map((e) => (
                      <Pill key={e.key} e={e} dim={draftsOnly && e.status !== "needs-you"} />
                    ))}
                    {more > 0 ? <li className="px-1.5 text-[12px] font-semibold text-ds-muted">+{more} more</li> : null}
                  </ul>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
