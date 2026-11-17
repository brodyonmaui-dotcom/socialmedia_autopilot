"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cx, FOCUS } from "./cx.js";
import { ChartLegend, SERIES_BG, SERIES_STROKE, type ChartSeries } from "./BarChart.js";
import { compactNumber, fullNumber, lineSegments, niceRange, niceTicks, pctIn } from "./chart-scale.js";
import { PlatformLogo } from "./PlatformLogo.js";

/**
 * Multi-series line chart: 2 px lines in the fixed series colours, y-axis ticks in Inter 11 px, x labels
 * under the plot (every `labelEvery`th plus the last), a legend with platform glyphs, and a visually hidden
 * table with every value. `values[seriesId][i]` lines up with `xLabels[i]`; null = no data that day (a gap
 * in the line, never a drop to 0).
 *
 * Reading values: hovering, tapping or focusing the plot shows a guide line, a dot per series and a
 * tooltip with each series' value for that day; arrow keys (Home / End) move along the days, Esc hides it.
 * `baseline="auto"` fits the y axis to the data (e.g. followers); the default starts at 0.
 */
export function LineChart({
  series,
  values,
  xLabels,
  xTitles,
  label,
  unit,
  height = 168,
  labelEvery = 1,
  legend = true,
  baseline = "zero",
  className,
}: {
  series: ChartSeries[];
  values: Record<string, Array<number | null>>;
  xLabels: string[];
  /** Full labels for the tooltip and the hidden table ("Tue, Nov 10"); defaults to xLabels. */
  xTitles?: string[];
  label: string;
  unit: string;
  height?: number;
  labelEvery?: number;
  legend?: boolean;
  baseline?: "zero" | "auto";
  className?: string;
}) {
  const W = 600;
  const n = xLabels.length;
  const all = series.flatMap((s) => values[s.id] ?? []);
  const finite = all.filter((v): v is number => v != null && Number.isFinite(v));
  const ticks = baseline === "auto" ? niceRange(finite, 4) : niceTicks(Math.max(0, ...finite), 4);
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const titles = xTitles ?? xLabels;
  // Compact ticks ("1.3k") unless that makes two ticks read the same (a fitted axis): then full numbers.
  const compact = ticks.map((t) => compactNumber(t));
  const tickText = new Set(compact).size === compact.length ? compact : ticks.map((t) => fullNumber(t));
  const xPct = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);

  const [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const tipId = useId();

  const indexAt = (clientX: number) => {
    const r = plot.current?.getBoundingClientRect();
    if (!r || r.width <= 0 || n === 0) return null;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return n === 1 ? 0 : Math.round(f * (n - 1));
  };
  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const i = indexAt(e.clientX);
    if (i !== null) setActive(i);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const cur = active ?? n - 1;
    const next = e.key === "ArrowLeft" ? Math.max(0, cur - 1) : e.key === "ArrowRight" ? Math.min(n - 1, cur + 1) : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (e.key === "Escape") {
      setActive(null);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  const reading =
    active === null
      ? ""
      : `${titles[active]}: ${series.map((s) => `${s.label} ${fullNumber(values[s.id]?.[active] ?? null)}`).join(", ")} ${unit}`;
  const tipRight = active !== null && xPct(active) > 55;

  return (
    <figure className={cx("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-w-0 gap-2">
        <div className="relative w-9 shrink-0" style={{ height }} aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={t} className="ds-num absolute right-0 whitespace-nowrap text-[11px] leading-none text-ds-muted" style={{ bottom: `${pctIn(t, lo, hi)}%`, transform: "translateY(50%)" }}>
              {tickText[i]}
            </span>
          ))}
        </div>
        <div
          ref={plot}
          tabIndex={0}
          role="group"
          aria-label={`${label}. Arrow keys read each day.`}
          onPointerMove={(e) => e.pointerType === "mouse" && onPointer(e)}
          onPointerDown={onPointer}
          onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
          className={cx("relative min-w-0 flex-1 cursor-crosshair rounded-ds-xs", FOCUS)}
          style={{ height }}
        >
          {ticks.map((t) => (
            <span key={t} aria-hidden="true" className={cx("absolute inset-x-0 border-t", t === lo ? "border-ds-line" : "border-dashed border-ds-line/70")} style={{ bottom: `${pctIn(t, lo, hi)}%` }} />
          ))}
          <svg aria-hidden="true" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {series.map((s) =>
              lineSegments(values[s.id] ?? [], lo, hi, W, height).map((pts, k) => (
                <polyline
                  key={`${s.id}-${k}`}
                  points={pts}
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  className={SERIES_STROKE[s.platform ?? "default"]}
                />
              )),
            )}
          </svg>
          {active !== null ? (
            <>
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 border-l border-ds-line-strong" style={{ left: `${xPct(active)}%` }} />
              {series.map((s) => {
                const v = values[s.id]?.[active];
                if (v == null) return null;
                return (
                  <span
                    key={s.id}
                    aria-hidden="true"
                    className={cx("pointer-events-none absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-ds-card", SERIES_BG[s.platform ?? "default"])}
                    style={{ left: `${xPct(active)}%`, bottom: `${pctIn(v, lo, hi)}%` }}
                  />
                );
              })}
              <span
                id={tipId}
                aria-hidden="true"
                className={cx(
                  "ds-num pointer-events-none absolute top-0 z-10 w-max min-w-36 rounded-ds-sm border border-ds-line bg-ds-card px-2.5 py-1.5 text-[12px] text-ds-text shadow-ds-pop",
                  tipRight ? "-translate-x-full -ml-2" : "ml-2",
                )}
                style={{ left: `${xPct(active)}%` }}
              >
                <span className="block font-semibold">{titles[active]}</span>
                {series.map((s) => (
                  <span key={s.id} className="flex items-center gap-1.5 text-ds-muted">
                    <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-full", SERIES_BG[s.platform ?? "default"])} />
                    {s.platform ? <PlatformLogo platform={s.platform} size={12} className="text-ds-text" /> : null}
                    <span className="flex-1">{s.label}</span>
                    <span className="pl-3 font-semibold text-ds-text">{fullNumber(values[s.id]?.[active] ?? null)}</span>
                  </span>
                ))}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex gap-2 pl-11" aria-hidden="true">
        <div className="relative h-3 min-w-0 flex-1">
          {xLabels.map((l, i) => {
            const shown = i % labelEvery === 0 || i === n - 1;
            // The last label always shows; drop a regular one that would sit on top of it.
            if (!shown || (i !== n - 1 && n - 1 - i < labelEvery / 2)) return null;
            const edge = i === 0 ? "translate-x-0" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2";
            return (
              <span key={i} className={cx("absolute top-0 whitespace-nowrap text-[11px] leading-none text-ds-muted", n > 1 && edge)} style={{ left: `${xPct(i)}%` }}>
                {l}
              </span>
            );
          })}
        </div>
      </div>
      {legend ? <ChartLegend series={series} /> : null}
      <p className="sr-only" aria-live="polite">
        {reading}
      </p>
      <table className="sr-only">
        <caption>
          {label} ({unit})
        </caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {series.map((s) => (
              <th key={s.id} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {titles.map((l, i) => (
            <tr key={i}>
              <th scope="row">{l}</th>
              {series.map((s) => (
                <td key={s.id}>{fullNumber(values[s.id]?.[i] ?? null)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
