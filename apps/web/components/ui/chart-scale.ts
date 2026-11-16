// Pure axis/scale helpers for BarChart and LineChart. Tested in __tests__/chart-scale.test.ts.

/** "1.2k", "34k", "1.5M"; integers below 1000 as-is. Null/NaN → "–". */
export function compactNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const fmt = (x: number, unit: string) => `${sign}${x >= 100 ? Math.round(x) : Number(x.toFixed(1))}${unit}`;
  if (a >= 1_000_000) return fmt(a / 1_000_000, "M");
  if (a >= 1_000) return fmt(a / 1_000, "k");
  return `${sign}${Math.round(a)}`;
}

/** Full number with thousands separators ("12,480"). */
export function fullNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  return Math.round(n).toLocaleString("en-US");
}

/**
 * "Nice" y-axis ticks from 0 to at least `max`, about `count` steps (1, 2, 2.5 or 5 × 10^k).
 * Always starts at 0 and has ≥ 2 ticks; max ≤ 0 → [0, 1].
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const top = Math.ceil(max / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Number(v.toPrecision(12)));
  return out.length >= 2 ? out : [0, step];
}

/** Sum of a stacked datum's series values (missing = 0). */
export function stackTotal(values: Record<string, number>, ids: readonly string[]): number {
  return ids.reduce((s, id) => s + (Number.isFinite(values[id]) ? Math.max(0, values[id]!) : 0), 0);
}

/** Percent height (0–100) of a value on an axis whose top is `top`. */
export function pct(value: number, top: number): number {
  if (!(top > 0) || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(100, (value / top) * 100);
}

/** Polyline points ("x,y x,y") for one series on a `w × h` box, y = 0 at the bottom; nulls break nothing (treated as 0). */
export function linePoints(values: Array<number | null>, top: number, w: number, h: number): string {
  const n = values.length;
  if (n === 0) return "";
  return values
    .map((v, i) => {
      const x = n === 1 ? w / 2 : (i / (n - 1)) * w;
      const y = h - (pct(v ?? 0, top) / 100) * h;
      return `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`;
    })
    .join(" ");
}
