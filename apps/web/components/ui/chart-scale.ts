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

/** Nice step (1, 2, 2.5 or 5 × 10^k) that splits `span` into about `count` parts. */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
}

/**
 * Ticks for a line chart that doesn't start at 0 (e.g. followers 1,700 → 1,760): nice ticks around
 * [min, max]. Bars always use `niceTicks` (from 0). No finite values → [0, 1].
 */
export function niceRange(values: Array<number | null | undefined>, count = 4): number[] {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!xs.length) return [0, 1];
  let lo = Math.min(...xs);
  let hi = Math.max(...xs);
  if (hi === lo) {
    const pad = Math.max(1, Math.abs(hi) * 0.05);
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, count);
  const start = Math.max(Math.min(...xs) >= 0 ? 0 : -Infinity, Math.floor(lo / step + 1e-9) * step);
  const out: number[] = [];
  for (let v = start; v <= Math.ceil(hi / step - 1e-9) * step + step / 2; v += step) out.push(Number(v.toPrecision(12)));
  return out.length >= 2 ? out : [start, start + step];
}

/** Percent position (0–100) of a value on an axis from `lo` to `hi`. */
export function pctIn(value: number, lo: number, hi: number): number {
  if (!(hi > lo) || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, ((value - lo) / (hi - lo)) * 100));
}

/**
 * Polyline point strings for one series, split at nulls (a missing day is a gap, never a drop to 0).
 * x spreads the indexes over `w`; y uses the axis [lo, hi] on `h` (0 at the bottom).
 */
export function lineSegments(values: Array<number | null>, lo: number, hi: number, w: number, h: number): string[] {
  const n = values.length;
  const out: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      if (cur.length) out.push(cur.join(" "));
      cur = [];
      return;
    }
    const x = n === 1 ? w / 2 : (i / (n - 1)) * w;
    const y = h - (pctIn(v, lo, hi) / 100) * h;
    cur.push(`${Number(x.toFixed(2))},${Number(y.toFixed(2))}`);
  });
  if (cur.length) out.push(cur.join(" "));
  return out;
}
