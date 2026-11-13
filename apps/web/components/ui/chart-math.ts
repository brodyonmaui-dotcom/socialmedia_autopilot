/**
 * Pure geometry for the design-system charts (Sparkline, MiniBars, AreaChart, Donut, MonthCalendar).
 * No React, no DOM — unit-tested in __tests__/chart-math.test.ts.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Arc = { d: string; value: number; fraction: number };

/** Round to 2 decimals and drop "-0". */
function r2(n: number): number {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Map values to SVG coordinates: x spread evenly over [0, w], y with max at the top
 * (after `pad.top`) and min at the bottom (before `pad.bottom`).
 * Flat series → a horizontal line in the middle; a single value → centred point; empty → [].
 */
export function scalePoints(
  values: number[],
  w: number,
  h: number,
  pad: { top?: number; bottom?: number } = {},
): Point[] {
  const n = values.length;
  if (n === 0) return [];
  const top = pad.top ?? 0;
  const bottom = pad.bottom ?? 0;
  const inner = Math.max(0, h - top - bottom);
  const mid = top + inner / 2;
  if (n === 1) return [{ x: w / 2, y: mid }];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values.map((v, i) => ({
    x: (i / (n - 1)) * w,
    y: span === 0 ? mid : top + (1 - (v - min) / span) * inner,
  }));
}

/** Straight polyline path: "M x y L x y …" with 2-decimal numbers. */
export function linePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${r2(p.x)} ${r2(p.y)}`).join(" ");
}

/**
 * Smooth path through the points (Catmull-Rom → cubic Bézier). Control points are clamped to
 * each segment's x- and y-range so the curve never overshoots the data's min/max.
 */
export function smoothPath(points: Point[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n < 3) return linePath(points);
  const first = points[0]!;
  let d = `M${r2(first.x)} ${r2(first.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const yLo = Math.min(p1.y, p2.y);
    const yHi = Math.max(p1.y, p2.y);
    const xLo = Math.min(p1.x, p2.x);
    const xHi = Math.max(p1.x, p2.x);
    const c1x = clamp(p1.x + (p2.x - p0.x) / 6, xLo, xHi);
    const c1y = clamp(p1.y + (p2.y - p0.y) / 6, yLo, yHi);
    const c2x = clamp(p2.x - (p3.x - p1.x) / 6, xLo, xHi);
    const c2y = clamp(p2.y - (p3.y - p1.y) / 6, yLo, yHi);
    d += ` C${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${r2(p2.x)} ${r2(p2.y)}`;
  }
  return d;
}

/** Filled area under the (smooth by default) line, closed down to y = h. */
export function areaPath(points: Point[], h: number, smooth = true): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const line = smooth ? smoothPath(points) : linePath(points);
  return `${line} L${r2(last.x)} ${r2(h)} L${r2(first.x)} ${r2(h)} Z`;
}

/**
 * Bars filling width `w` with `gap` between them, heights relative to the max value.
 * Negative values clamp to 0; zero-height bars get 2 px so they stay visible.
 */
export function barRects(values: number[], w: number, h: number, gap: number): Rect[] {
  const n = values.length;
  if (n === 0) return [];
  const width = Math.max(0, (w - gap * (n - 1)) / n);
  const vals = values.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
  const max = Math.max(...vals);
  const MIN = Math.min(2, h);
  return vals.map((v, i) => {
    const height = Math.max(MIN, max > 0 ? (v / max) * h : 0);
    return { x: r2(i * (width + gap)), y: r2(h - height), width: r2(width), height: r2(height) };
  });
}

/**
 * Ring segments (filled annular sectors) for a donut of outer radius `r`, centred at (r, r),
 * starting at 12 o'clock and running clockwise. A single 100% segment is drawn as two half arcs
 * per edge (an SVG arc can't start and end at the same point). Zero-sum → []. Zero/negative values
 * produce an entry with d = "" and fraction 0.
 */
export function donutArcs(values: number[], r: number, thickness: number): Arc[] {
  const vals = values.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
  const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const ri = Math.max(0, r - thickness);
  const at = (rad: number, angle: number) => ({
    x: r2(r + rad * Math.cos(angle)),
    y: r2(r + rad * Math.sin(angle)),
  });
  let start = -Math.PI / 2;
  return vals.map((value, i) => {
    const fraction = value / total;
    if (fraction <= 0) return { d: "", value: values[i]!, fraction: 0 };
    if (fraction >= 1 - 1e-9) {
      const d =
        `M${r2(r)} 0 A${r2(r)} ${r2(r)} 0 1 1 ${r2(r)} ${r2(2 * r)} A${r2(r)} ${r2(r)} 0 1 1 ${r2(r)} 0 Z ` +
        `M${r2(r)} ${r2(r - ri)} A${r2(ri)} ${r2(ri)} 0 1 0 ${r2(r)} ${r2(r + ri)} A${r2(ri)} ${r2(ri)} 0 1 0 ${r2(r)} ${r2(r - ri)} Z`;
      return { d, value: values[i]!, fraction };
    }
    const end = start + fraction * 2 * Math.PI;
    const large = fraction > 0.5 ? 1 : 0;
    const o1 = at(r, start);
    const o2 = at(r, end);
    const i2 = at(ri, end);
    const i1 = at(ri, start);
    const d =
      `M${o1.x} ${o1.y} A${r2(r)} ${r2(r)} 0 ${large} 1 ${o2.x} ${o2.y} ` +
      `L${i2.x} ${i2.y} A${r2(ri)} ${r2(ri)} 0 ${large} 0 ${i1.x} ${i1.y} Z`;
    start = end;
    return { d, value: values[i]!, fraction };
  });
}

/**
 * Calendar weeks for a month: rows of 7 cells holding the day number or null for padding.
 * `weekStartsOn` 1 = Monday (default), 0 = Sunday. UTC math, so the host time zone can't shift days.
 */
export function monthGrid(year: number, month0: number, weekStartsOn: 0 | 1 = 1): (number | null)[][] {
  const firstDow = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const lead = (firstDow - weekStartsOn + 7) % 7;
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
