import { cx } from "./cx.js";

export interface ProgressBarProps {
  value: number;
  max?: number;
  label: string;
  /** Show the label above the bar with a right-aligned "value/max" (default: label is sr-only). */
  showLabel?: boolean;
  /** Overrides aria-valuetext and the visible "3/8" figure. */
  valueText?: string;
  className?: string;
}

/** v2: 4px square-ended accent fill on a ds-line track; role=progressbar with values. */
export function ProgressBar({ value, max = 100, label, showLabel = false, valueText, className }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const v = Math.min(safeMax, Math.max(0, value));
  const pct = (v / safeMax) * 100;
  const text = valueText ?? `${v}/${safeMax}`;
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <div className={cx("flex items-baseline justify-between gap-3", !showLabel && "sr-only")}>
        <span className="ds-caps text-ds-muted">{label}</span>
        <span aria-hidden="true" className="ds-mono text-ds-text">
          {text}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={v}
        aria-valuetext={text}
        className="h-1 w-full overflow-hidden bg-ds-line"
      >
        <div
          className="h-full bg-ds-accent transition-[width] duration-[600ms] ease-ds"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
