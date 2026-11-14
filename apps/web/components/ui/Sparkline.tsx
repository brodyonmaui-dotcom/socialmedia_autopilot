import { useId } from "react";
import { cx } from "./cx.js";
import { areaPath, barRects, scalePoints, smoothPath } from "./chart-math.js";

/** Small smooth accent trend line (1.5px). */
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
        strokeWidth={1.5}
        strokeLinecap="square"
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
            className={i === highlightIndex ? "fill-ds-accent" : "fill-ds-line-strong/40"}
          />
        ))}
      </svg>
      {labels && labels.length > 0 && (
        <div aria-hidden="true" className="mt-2 flex gap-1">
          {labels.map((l, i) => (
            <span
              key={i}
              className={cx(
                "flex-1 text-center ds-mono leading-tight",
                i === highlightIndex ? "text-ds-accent-fg" : "text-ds-faint",
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
 * Line keeps a constant 1.5px stroke despite the stretched viewBox; flat 8% accent fill (no gradient);
 * last point gets a 6px square marker.
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
        {pts.length > 0 && (
          <>
            <path d={areaPath(pts, height)} fill="currentColor" fillOpacity={0.08} />
            <path
              d={smoothPath(pts)}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="square"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      {last && (
        <span
          aria-hidden="true"
          className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 bg-ds-accent"
          style={{ left: `min(calc(100% - 6px), ${(last.x / W) * 100}%)`, top: last.y }}
        />
      )}
      {hasLabels && (
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 flex justify-between px-5 pb-2">
          {xLabels!.map((l, i) => (
            <span key={i} className="ds-mono leading-tight text-ds-faint">
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
