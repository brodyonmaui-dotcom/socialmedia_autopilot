import { useId } from "react";
import { cx } from "./cx.js";
import { donutArcs } from "./chart-math.js";

export type DonutTone = "accent" | "hi" | "gray1" | "gray2" | "gray3";
export type DonutSegment = { label: string; value: number; tone: DonutTone };

/** Fill (SVG) and background (legend square) per tone. v2: one accent, then text / muted / line-strong / line. */
const TONE: Record<DonutTone, { fill: string; dot: string }> = {
  accent: { fill: "fill-ds-accent", dot: "bg-ds-accent" },
  hi: { fill: "fill-ds-text", dot: "bg-ds-text" },
  gray1: { fill: "fill-ds-muted", dot: "bg-ds-muted" },
  gray2: { fill: "fill-ds-line-strong", dot: "bg-ds-line-strong" },
  gray3: { fill: "fill-ds-line", dot: "bg-ds-line" },
};

const RING = 10;

const fmt = (n: number) => n.toLocaleString("en-US");

/** Share-of-total ring (10px thick) with optional centre value and a legend. ≤5 segments. */
export function Donut({
  segments,
  centerValue,
  centerLabel,
  size = 140,
  label,
  className,
}: {
  segments: DonutSegment[];
  centerValue?: string;
  centerLabel?: string;
  size?: number;
  label: string;
  className?: string;
}) {
  const titleId = useId();
  const r = size / 2;
  const arcs = donutArcs(
    segments.map((s) => s.value),
    r,
    RING,
  );
  const summary = `${label}: ${segments.map((s) => `${s.label} ${fmt(s.value)}`).join(", ")}`;
  return (
    <div className={cx("flex flex-col items-center gap-5 sm:flex-row sm:items-center", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg role="img" aria-labelledby={titleId} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <title id={titleId}>{summary}</title>
          {arcs.length === 0 ? (
            <circle cx={r} cy={r} r={r - RING / 2} fill="none" strokeWidth={RING} className="stroke-ds-raised" />
          ) : (
            arcs.map((a, i) =>
              a.d ? <path key={i} d={a.d} fillRule="evenodd" className={TONE[segments[i]!.tone].fill} /> : null,
            )
          )}
        </svg>
        {(centerValue || centerLabel) && (
          <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {centerValue && <span className="ds-num text-[28px] font-black leading-none tracking-[-0.04em]">{centerValue}</span>}
            {centerLabel && <span className="mt-1.5 ds-caps text-ds-muted">{centerLabel}</span>}
          </div>
        )}
      </div>
      <ul className="flex w-full min-w-0 flex-col gap-2">
        {segments.map((s, i) => (
          <li key={i} className="flex items-center gap-2.5">
            <span aria-hidden="true" className={cx("size-2 shrink-0", TONE[s.tone].dot)} />
            <span className="min-w-0 flex-1 truncate text-[15px] text-ds-muted">{s.label}</span>
            <span className="ds-num text-[15px] font-bold">{fmt(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
