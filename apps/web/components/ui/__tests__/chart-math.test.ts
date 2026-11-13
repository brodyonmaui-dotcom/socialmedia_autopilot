import { describe, expect, it } from "vitest";
import { areaPath, barRects, donutArcs, linePath, monthGrid, scalePoints, smoothPath } from "../chart-math.js";

/** All numbers appearing in a path string. */
function nums(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

/** y values of every coordinate pair in an M/L/C path. */
function ys(d: string): number[] {
  return nums(d).filter((_, i) => i % 2 === 1);
}

describe("scalePoints", () => {
  it("maps min to the bottom and max to the top, x evenly spaced", () => {
    const pts = scalePoints([0, 5, 10], 100, 50);
    expect(pts).toEqual([
      { x: 0, y: 50 },
      { x: 50, y: 25 },
      { x: 100, y: 0 },
    ]);
  });

  it("respects top/bottom padding", () => {
    const pts = scalePoints([1, 3], 10, 100, { top: 10, bottom: 20 });
    expect(pts[0]!.y).toBe(80);
    expect(pts[1]!.y).toBe(10);
  });

  it("draws a flat series as a middle line", () => {
    const pts = scalePoints([4, 4, 4], 90, 40);
    expect(pts.map((p) => p.y)).toEqual([20, 20, 20]);
    expect(pts.map((p) => p.x)).toEqual([0, 45, 90]);
  });

  it("centres a single value", () => {
    expect(scalePoints([7], 120, 36)).toEqual([{ x: 60, y: 18 }]);
  });

  it("returns [] for empty input", () => {
    expect(scalePoints([], 100, 50)).toEqual([]);
  });
});

describe("linePath", () => {
  it("formats M/L commands with 2-decimal numbers", () => {
    expect(linePath([{ x: 0, y: 1.23456 }, { x: 33.333333, y: 2 }, { x: 66.666666, y: 0 }])).toBe(
      "M0 1.23 L33.33 2 L66.67 0",
    );
  });
  it("is empty for no points", () => {
    expect(linePath([])).toBe("");
  });
});

describe("smoothPath", () => {
  it("never leaves the data's y-range", () => {
    const values = [3, 10, 0, 9, 9, 1, 7, 2];
    const pts = scalePoints(values, 300, 100, { top: 8, bottom: 8 });
    const d = smoothPath(pts);
    expect(d.startsWith("M")).toBe(true);
    expect(d).toContain("C");
    const yv = ys(d);
    expect(Math.min(...yv)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...yv)).toBeLessThanOrEqual(92);
  });
  it("keeps each segment's control points inside the segment's y-range", () => {
    const pts = scalePoints([0, 10, 10, 0], 90, 50);
    const segs = smoothPath(pts).split(" C").slice(1).map(nums);
    segs.forEach((seg, i) => {
      const lo = Math.min(pts[i]!.y, pts[i + 1]!.y);
      const hi = Math.max(pts[i]!.y, pts[i + 1]!.y);
      for (const y of [seg[1]!, seg[3]!, seg[5]!]) {
        expect(y).toBeGreaterThanOrEqual(lo);
        expect(y).toBeLessThanOrEqual(hi);
      }
    });
  });
  it("falls back to a line for two points and '' for none", () => {
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe("M0 0 L10 5");
    expect(smoothPath([])).toBe("");
  });
});

describe("areaPath", () => {
  it("closes down to the bottom edge", () => {
    const pts = scalePoints([1, 2, 3], 100, 40);
    const d = areaPath(pts, 40);
    expect(d.startsWith("M0 40")).toBe(true);
    expect(d.endsWith("L100 40 L0 40 Z")).toBe(true);
    expect(areaPath(pts, 40, false)).toBe("M0 40 L50 20 L100 0 L100 40 L0 40 Z");
  });
  it("is empty without points", () => {
    expect(areaPath([], 40)).toBe("");
  });
});

describe("barRects", () => {
  it("splits width by gap and scales heights to the max", () => {
    const bars = barRects([5, 10, 0], 100, 50, 5);
    expect(bars.map((b) => b.width)).toEqual([30, 30, 30]);
    expect(bars.map((b) => b.x)).toEqual([0, 35, 70]);
    expect(bars[1]).toEqual({ x: 35, y: 0, width: 30, height: 50 });
    expect(bars[0]!.height).toBe(25);
    expect(bars[0]!.y).toBe(25);
  });
  it("gives zero and negative bars a visible 2px minimum", () => {
    const bars = barRects([0, -4, 8], 30, 20, 0);
    expect(bars[0]!.height).toBe(2);
    expect(bars[1]!.height).toBe(2);
    expect(bars[1]!.y).toBe(18);
    expect(bars[2]!.height).toBe(20);
  });
  it("handles all-zero and empty input", () => {
    expect(barRects([0, 0], 10, 10, 2).every((b) => b.height === 2)).toBe(true);
    expect(barRects([], 10, 10, 2)).toEqual([]);
  });
});

describe("donutArcs", () => {
  it("returns fractions that sum to 1", () => {
    const arcs = donutArcs([3, 1, 4, 2], 70, 16);
    expect(arcs).toHaveLength(4);
    expect(arcs.reduce((a, b) => a + b.fraction, 0)).toBeCloseTo(1, 10);
    expect(arcs[2]!.fraction).toBeCloseTo(0.4);
    for (const a of arcs) expect(a.d).toMatch(/^M.* A.* L.* A.* Z$/);
  });
  it("uses the large-arc flag for segments over half", () => {
    const [big, small] = donutArcs([3, 1], 50, 10);
    expect(big!.d).toContain(" 0 1 1 ");
    expect(small!.d).toContain(" 0 0 1 ");
  });
  it("draws a single 100% segment as half arcs (full ring)", () => {
    const arcs = donutArcs([0, 5], 70, 16);
    expect(arcs[0]).toEqual({ d: "", value: 0, fraction: 0 });
    expect(arcs[1]!.fraction).toBe(1);
    expect(arcs[1]!.d.match(/A/g)).toHaveLength(4);
    expect(arcs[1]!.d).toContain("M70 0 A70 70 0 1 1 70 140");
  });
  it("returns [] when the total is zero", () => {
    expect(donutArcs([0, 0], 70, 16)).toEqual([]);
    expect(donutArcs([], 70, 16)).toEqual([]);
  });
});

describe("monthGrid", () => {
  it("Nov 2026 starts on a Sunday: Monday-start grid leads with 6 nulls, 30 days", () => {
    const g = monthGrid(2026, 10);
    expect(g[0]).toEqual([null, null, null, null, null, null, 1]);
    expect(g.every((w) => w.length === 7)).toBe(true);
    const days = g.flat().filter((d): d is number => d !== null);
    expect(days).toHaveLength(30);
    expect(days[29]).toBe(30);
    expect(g).toHaveLength(6);
    expect(g[5]).toEqual([30, null, null, null, null, null, null]);
  });
  it("Nov 2026 with Sunday start has no leading nulls", () => {
    const g = monthGrid(2026, 10, 0);
    expect(g[0]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(g).toHaveLength(5);
  });
  it("Feb 2027 (Monday 1st, 28 days) fills exactly 4 Monday-start weeks", () => {
    const g = monthGrid(2027, 1);
    expect(g).toHaveLength(4);
    expect(g[0]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(g[3]![6]).toBe(28);
    expect(g.flat()).not.toContain(null);
    const sun = monthGrid(2027, 1, 0);
    expect(sun[0]![0]).toBeNull();
    expect(sun[0]![1]).toBe(1);
  });
});
