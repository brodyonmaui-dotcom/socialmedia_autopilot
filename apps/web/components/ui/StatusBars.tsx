import { cx } from "./cx.js";

export type StatusBarRow = { label: string; value: number; note?: string };

const clamp = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

/** Labelled 2px meters (e.g. platform → % ready). Each bar is a role="meter" with its value as text too. */
export function StatusBars({ rows, className }: { rows: StatusBarRow[]; className?: string }) {
  return (
    <ul className={cx("flex flex-col gap-3", className)}>
      {rows.map((r) => {
        const v = Math.round(clamp(r.value));
        return (
          <li key={r.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="ds-mono uppercase text-ds-text">{r.label}</span>
              <span className="ds-num text-[13px] font-bold text-ds-text">{v}%</span>
            </div>
            <div
              role="meter"
              aria-label={r.label}
              aria-valuenow={v}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={r.note ? `${v}%, ${r.note}` : `${v}%`}
              className="mt-1.5 h-0.5 bg-ds-line"
            >
              <div className="h-full bg-ds-accent" style={{ width: `${v}%` }} />
            </div>
            {r.note && <p className="ds-mono mt-1 text-ds-faint">{r.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}
