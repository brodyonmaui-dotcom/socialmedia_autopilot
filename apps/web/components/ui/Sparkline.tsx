import { useId } from "react";
import { cx } from "./cx.js";
import { areaPath, barRects, scalePoints, smoothPath } from "./chart-math.js";

/** Small smooth accent trend line. */
export function Sparkline({
  values,
  width = 120,
  height = 36,
  label,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  label: string;
  className?: string;
}) {
  const titleId = useId();
  const pts = scalePoints(values, width, height, { top: 3, bottom: 3 });
  return (
    <svg
      role="img"
      aria-labelledby={titleId}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cx("overflow-visible text-ds-accent", className)}
    >
      <title id={titleId}>{label}</title>
      <path
        d={smoothPath(pts)}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Row of small bars (e.g. per-day counts) along a card's bottom; one bar can be highlighted in accent. */
export function MiniBars({
  values,
  labels,
  highlightIndex,
  height = 48,
  label,
  className,
}: {
  values: number[];
  labels?: string[];
  highlightIndex?: number;
  height?: number;
  label: string;
  className?: string;
}) {
  const titleId = useId();
  const n = values.length;
  const unit = 10;
  const gap = 4;
  const w = Math.max(1, n * unit + (n - 1) * gap);
  const rects = barRects(values, w, height, gap);
  return (
    <div className={className}>
      <svg
        role="img"
        aria-labelledby={titleId}
        width="100%"
        height={height}
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        className="block"
      >
        <title id={titleId}>{label}</title>
        {rects.map((r, i) => (
          <rect
            key={i}
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
            rx={Math.min(3, r.width / 2)}
            className={i === highlightIndex ? "fill-ds-accent" : "fill-ds-line-strong"}
          />
        ))}
      </svg>
      {labels && labels.length > 0 && (
        <div aria-hidden="true" className="mt-1.5 flex gap-1">
          {labels.map((l, i) => (
            <span
              key={i}
              className={cx(
                "flex-1 text-center text-[13px] leading-tight",
                i === highlightIndex ? "text-ds-accent" : "text-ds-faint",
              )}
            >
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Full-width accent area chart that bleeds to its container's edges (put it in Card `bleed`).
 * Line keeps a constant 2px stroke despite the stretched viewBox; last point gets a dot.
 */
export function AreaChart({
  values,
  height = 120,
  label,
  xLabels,
  className,
}: {
  values: number[];
  height?: number;
  label: string;
  xLabels?: string[];
  className?: string;
}) {
  const uid = useId();
  const titleId = `${uid}-t`;
  const gradId = `${uid}-g`;
  const W = 300;
  const hasLabels = Boolean(xLabels && xLabels.length > 0);
  const pts = scalePoints(values, W, height, { top: 12, bottom: hasLabels ? 30 : 8 });
  const last = pts[pts.length - 1];
  return (
    <div className={cx("relative w-full text-ds-accent", className)} style={{ height }}>
      <svg
        role="img"
        aria-labelledby={titleId}
        width="100%"
        height={height}
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="absolute inset-0 block"
      >
        <title id={titleId}>{label}</title>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.35} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        {pts.length > 0 && (
          <>
            <path d={areaPath(pts, height)} fill={`url(#${gradId})`} />
            <path
              d={smoothPath(pts)}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      {last && (
        <span
          aria-hidden="true"
          className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ds-accent ring-2 ring-ds-card"
          style={{ left: `min(calc(100% - 6px), ${(last.x / W) * 100}%)`, top: last.y }}
        />
      )}
      {hasLabels && (
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 flex justify-between px-5 pb-2">
          {xLabels!.map((l, i) => (
            <span key={i} className="ds-num text-[13px] leading-tight text-ds-faint">
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
