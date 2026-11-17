import { cx } from "../ui/index.js";
import type { HourStat } from "../../lib/analytics/platform.js";
import { hourBars } from "../../lib/analytics/present.js";

/**
 * Best posting time: five labelled bars (local hour ranges) of median views. The best bucket is named in
 * words ("Best"), not only by colour; buckets under the minimum say "too few" and draw no bar.
 */
export function BestHours({ hours }: { hours: HourStat[] }) {
  const bars = hourBars(hours);
  return (
    <ol aria-label="Median views by posting time" className="flex flex-col gap-3">
      {bars.map((b) => (
        <li key={b.bucket} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className={cx("ds-num", b.best ? "font-bold text-ds-text" : "text-ds-text")}>{b.label}</span>
            <span className="ds-num shrink-0 text-[13px] text-ds-muted">
              {b.value ? (
                <>
                  <span className="font-semibold text-ds-text">{b.value}</span> median ·{" "}
                </>
              ) : null}
              <span className={b.best ? "font-semibold text-ds-accent-fg" : undefined}>{b.note}</span>
            </span>
          </div>
          <span className="relative h-2 overflow-hidden rounded-full bg-ds-line/60" aria-hidden="true">
            {b.width > 0 ? <span className={cx("absolute inset-y-0 left-0 rounded-full", b.best ? "bg-ds-accent" : "bg-ds-line-strong")} style={{ width: `${b.width}%` }} /> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
