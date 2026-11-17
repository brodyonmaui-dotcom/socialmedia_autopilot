import Link from "next/link";
import { cx, FOCUS } from "./cx.js";
import { compactNumber, fullNumber, niceTicks, pct, stackTotal } from "./chart-scale.js";
import { PlatformLogo, type Platform } from "./PlatformLogo.js";

/** A chart series. Platform series take their fixed colour (IG blue, YT ink, TikTok slate, Snapchat sand). */
export type ChartSeries = { id: string; label: string; platform?: Platform };

/** Fixed series colours (never cycled). Non-platform series use the accent. */
export const SERIES_BG: Record<Platform | "default", string> = {
  instagram: "bg-ds-series-instagram",
  youtube: "bg-ds-series-youtube",
  tiktok: "bg-ds-series-tiktok",
  snapchat: "bg-ds-series-snapchat",
  default: "bg-ds-accent",
};
export const SERIES_STROKE: Record<Platform | "default", string> = {
  instagram: "stroke-ds-series-instagram",
  youtube: "stroke-ds-series-youtube",
  tiktok: "stroke-ds-series-tiktok",
  snapchat: "stroke-ds-series-snapchat",
  default: "stroke-ds-accent",
};

export type BarDatum = {
  /** Short x label ("Mon"). */
  label: string;
  /** Full label for the tooltip and the hidden table ("Mon 16 Nov"). */
  title?: string;
  values: Record<string, number>;
  href?: string;
  /** Marks the bar's label (e.g. today) in ink bold. */
  highlight?: boolean;
};

/** Legend: platform glyph (or a colour square) + name, so colour is never the only key. */
export function ChartLegend({ series }: { series: ChartSeries[] }) {
  return (
    <ul aria-hidden="true" className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {series.map((s) => (
        <li key={s.id} className="flex items-center gap-1.5 text-[13px] text-ds-muted">
          <span className={cx("size-2.5 shrink-0 rounded-full", SERIES_BG[s.platform ?? "default"])} />
          {s.platform ? <PlatformLogo platform={s.platform} size={14} className="text-ds-text" /> : null}
          <span>{s.label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Per-day bars, optionally stacked by series. Y-axis ticks in Inter 11 px, bars with a 3 px top radius,
 * no gradients. Each bar is focusable: hover or focus shows its values; a visually hidden table carries
 * every number for screen readers. `unit` names the measure ("views").
 */
export function BarChart({
  data,
  series,
  label,
  unit,
  height = 168,
  legend = true,
  labelEvery = 1,
  className,
}: {
  data: BarDatum[];
  series: ChartSeries[];
  /** Accessible chart name ("Views per day, by platform"). */
  label: string;
  unit: string;
  height?: number;
  legend?: boolean;
  /** Show every nth x label (plus the last), for 30–60 day ranges on a phone. */
  labelEvery?: number;
  className?: string;
}) {
  // Many bars (30–60 days) get thinner gaps so each bar keeps some width on a phone.
  const gap = data.length > 31 ? "gap-px" : data.length > 14 ? "gap-0.5 sm:gap-1" : "gap-1.5 sm:gap-2";
  const ids = series.map((s) => s.id);
  const totals = data.map((d) => stackTotal(d.values, ids));
  const ticks = niceTicks(Math.max(0, ...totals), 4);
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
          <ul className={cx("absolute inset-0 flex items-end", gap)} aria-label={label}>
            {data.map((d, i) => {
              const total = totals[i]!;
              const name = d.title ?? d.label;
              const parts = series.filter((s) => (d.values[s.id] ?? 0) > 0);
              const aria = `${name}: ${fullNumber(total)} ${unit}${series.length > 1 && parts.length ? ` (${parts.map((s) => `${s.label} ${fullNumber(d.values[s.id]!)}`).join(", ")})` : ""}`;
              const bar = (
                <>
                  <span className="flex w-full max-w-7 flex-col-reverse overflow-hidden rounded-t-ds-bar" style={{ height: `${pct(total, top)}%` }}>
                    {series.map((s) => {
                      const v = d.values[s.id] ?? 0;
                      if (v <= 0) return null;
                      return <span key={s.id} className={cx("block w-full shrink-0", SERIES_BG[s.platform ?? "default"])} style={{ height: `${(v / total) * 100}%` }} />;
                    })}
                  </span>
                  <span
                    role="tooltip"
                    className="ds-num pointer-events-none invisible absolute bottom-full left-1/2 z-10 mb-1 w-max -translate-x-1/2 rounded-ds-sm border border-ds-line bg-ds-card px-2.5 py-1.5 text-left text-[12px] text-ds-text opacity-0 shadow-ds-pop transition-opacity duration-[var(--ds-dur-fast)] group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
                  >
                    <span className="block font-semibold">{name}</span>
                    <span className="block text-ds-muted">
                      {fullNumber(total)} {unit}
                    </span>
                  </span>
                </>
              );
              const cls = cx("group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-ds-xs outline-none", FOCUS);
              return (
                <li key={i} className="relative flex h-full min-w-0 flex-1">
                  {d.href ? (
                    <Link href={d.href} aria-label={aria} className={cls}>
                      {bar}
                    </Link>
                  ) : (
                    <span tabIndex={0} aria-label={aria} className={cls}>
                      {bar}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="flex gap-2 pl-10" aria-hidden="true">
        <div className={cx("flex min-w-0 flex-1", gap)}>
          {data.map((d, i) => {
            const shown = labelEvery <= 1 || i === data.length - 1 || (i % labelEvery === 0 && data.length - 1 - i >= labelEvery / 2);
            return (
              <span key={i} className={cx("flex min-w-0 flex-1 justify-center whitespace-nowrap text-[11px] leading-none", d.highlight ? "font-bold text-ds-text" : "text-ds-muted")}>
                {shown ? d.label : null}
              </span>
            );
          })}
        </div>
      </div>
      {legend && series.length > 1 ? <ChartLegend series={series} /> : null}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {series.map((s) => (
              <th key={s.id} scope="col">
                {s.label}
              </th>
            ))}
            {series.length > 1 ? <th scope="col">Total</th> : null}
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <th scope="row">{d.title ?? d.label}</th>
              {series.map((s) => (
                <td key={s.id}>{fullNumber(d.values[s.id] ?? 0)}</td>
              ))}
              {series.length > 1 ? <td>{fullNumber(totals[i]!)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
