import Link from "next/link";
import { cx, FOCUS } from "./cx.js";
import { monthGrid } from "./chart-math.js";

export type DayMark = "accent" | "warn" | "muted";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
/** Monday-first weekday headers (rotated for Sunday-first). */
const WEEKDAYS: Array<[short: string, long: string]> = [
  ["M", "Monday"], ["T", "Tuesday"], ["W", "Wednesday"], ["T", "Thursday"],
  ["F", "Friday"], ["S", "Saturday"], ["S", "Sunday"],
];

const DOT: Record<DayMark, string> = { accent: "bg-ds-accent", warn: "bg-ds-warn", muted: "bg-ds-faint" };
const WORD: Record<DayMark, string> = { accent: "scheduled", warn: "needs action", muted: "posted" };

function dayLabel(month0: number, day: number, marks: DayMark[], isToday: boolean): string {
  const counts = (["accent", "warn", "muted"] as const)
    .map((k) => [marks.filter((m) => m === k).length, WORD[k]] as const)
    .filter(([n]) => n > 0)
    .map(([n, w]) => `${n} ${w}`);
  return `${MONTHS[month0]} ${day}${counts.length ? `: ${counts.join(", ")}` : ""}${isToday ? " (today)" : ""}`;
}

/**
 * Compact month grid (Monday first by default; weekStartsOn={0} for Sunday): tabular day numbers, today in a square ds-text border, up to 3 square 4px marks per day
 * (accent = scheduled, warn = needs action, muted = other). Days link when `hrefFor` is given.
 */
export function MonthCalendar({
  year,
  month0,
  today,
  marks = {},
  label,
  hrefFor,
  weekStartsOn = 1,
  className,
}: {
  year: number;
  month0: number;
  today?: number;
  marks?: Record<number, DayMark[]>;
  label?: string;
  hrefFor?: (day: number) => string;
  /** 1 = Monday (default), 0 = Sunday. */
  weekStartsOn?: 0 | 1;
  className?: string;
}) {
  const weeks = monthGrid(year, month0, weekStartsOn);
  const weekdays = weekStartsOn === 0 ? [WEEKDAYS[6]!, ...WEEKDAYS.slice(0, 6)] : WEEKDAYS;
  const cell = hrefFor ? "size-11" : "size-10";
  return (
    <table className={cx("w-full table-fixed border-collapse", className)}>
      <caption className="ds-caps mb-3 text-left text-ds-muted">
        {label ?? `${MONTHS_LONG[month0]} ${year}`}
      </caption>
      <thead>
        <tr>
          {weekdays.map(([s, l]) => (
            <th key={l} scope="col" abbr={l} className="pb-2 text-center ds-caps text-ds-faint">
              {s}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, wi) => (
          <tr key={wi}>
            {week.map((day, di) => {
              if (day === null) return <td key={di} />;
              const dayMarks = (marks[day] ?? []).slice(0, 3);
              const isToday = day === today;
              const aria = dayLabel(month0, day, marks[day] ?? [], isToday);
              const content = (
                <>
                  <span
                    className={cx(
                      "ds-num inline-flex size-8 items-center justify-center border text-[14px] leading-none",
                      isToday ? "border-ds-text font-bold text-ds-text" : "border-transparent",
                    )}
                  >
                    {day}
                  </span>
                  <span aria-hidden="true" className="flex h-1 gap-[3px]">
                    {dayMarks.map((m, i) => (
                      <span key={i} className={cx("size-1", DOT[m])} />
                    ))}
                  </span>
                </>
              );
              const box = cx(cell, "mx-auto flex flex-col items-center justify-center gap-0.5");
              return (
                <td key={di} className="p-0 text-center">
                  {hrefFor ? (
                    <Link
                      href={hrefFor(day)}
                      aria-label={aria}
                      aria-current={isToday ? "date" : undefined}
                      className={cx(box, "transition-colors duration-300 ease-ds hover:bg-ds-raised", FOCUS)}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className={box} aria-label={aria} role="img" aria-current={isToday ? "date" : undefined}>
                      {content}
                    </div>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
