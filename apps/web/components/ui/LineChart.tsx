import { cx } from "./cx.js";
import { ChartLegend, SERIES_STROKE, type ChartSeries } from "./BarChart.js";
import { compactNumber, fullNumber, linePoints, niceTicks, pct } from "./chart-scale.js";

/**
 * Multi-series line chart: 2 px lines in the fixed series colours, y-axis ticks in Inter 11 px, x labels
 * under the plot (every label, or every `labelEvery`th), a legend with platform glyphs, and a visually
 * hidden table with every value. `values[seriesId][i]` lines up with `xLabels[i]`; null = no data that day.
 */
export function LineChart({
  series,
  values,
  xLabels,
  label,
  unit,
  height = 168,
  labelEvery = 1,
  legend = true,
  className,
}: {
  series: ChartSeries[];
  values: Record<string, Array<number | null>>;
  xLabels: string[];
  label: string;
  unit: string;
  height?: number;
  labelEvery?: number;
  legend?: boolean;
  className?: string;
}) {
  const W = 600;
  const all = series.flatMap((s) => (values[s.id] ?? []).filter((v): v is number => v != null && Number.isFinite(v)));
  const ticks = niceTicks(Math.max(0, ...all), 4);
  const top = ticks[ticks.length - 1]!;
  return (
    <figure className={cx("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-w-0 gap-2">
        <div className="relative w-8 shrink-0" style={{ height }} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="ds-num absolute right-0 text-[11px] leading-none text-ds-muted" style={{ bottom: `${pct(t, top)}%`, transform: "translateY(50%)" }}>
              {compactNumber(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} aria-hidden="true" className={cx("absolute inset-x-0 border-t", t === 0 ? "border-ds-line" : "border-dashed border-ds-line/70")} style={{ bottom: `${pct(t, top)}%` }} />
          ))}
          <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {series.map((s) => (
              <polyline
                key={s.id}
                points={linePoints(values[s.id] ?? [], top, W, height)}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className={SERIES_STROKE[s.platform ?? "default"]}
              />
            ))}
          </svg>
        </div>
      </div>
      <div className="flex gap-2 pl-10" aria-hidden="true">
        <div className="relative flex min-w-0 flex-1 justify-between">
          {xLabels.map((l, i) => (
            <span key={i} className={cx("text-[11px] leading-none text-ds-muted", i % labelEvery !== 0 && i !== xLabels.length - 1 && "invisible")}>
              {l}
            </span>
          ))}
        </div>
      </div>
      {legend ? <ChartLegend series={series} /> : null}
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
          {xLabels.map((l, i) => (
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
