import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarChart } from "../BarChart.js";
import { compactNumber, fullNumber, linePoints, lineSegments, niceRange, niceTicks, pct, pctIn, stackTotal } from "../chart-scale.js";
import { isPaletteShortcut } from "../CommandPalette.js";
import { LineChart } from "../LineChart.js";
import { nextIndex, placePanel } from "../popover-position.js";

const anchor = (top: number, left: number, w = 40, hgt = 40) => ({ top, left, bottom: top + hgt, right: left + w, width: w, height: hgt });
const VP = { width: 390, height: 844 };

describe("placePanel", () => {
  it("goes below the trigger by default", () => {
    expect(placePanel(anchor(8, 300), { width: 200, height: 300 }, VP, { align: "end" })).toMatchObject({ side: "below", top: 56, left: 140 });
  });
  it("flips above at the bottom edge", () => {
    const p = placePanel(anchor(780, 20), { width: 200, height: 300 }, VP);
    expect(p.side).toBe("above");
    expect(p.top).toBe(780 - 8 - 300);
  });
  it("is clamped inside the viewport horizontally", () => {
    expect(placePanel(anchor(8, 360), { width: 300, height: 100 }, VP).left).toBe(390 - 8 - 300);
    expect(placePanel(anchor(8, 0), { width: 300, height: 100 }, VP, { align: "end" }).left).toBe(8);
  });
});

describe("nextIndex (menu keys)", () => {
  it("wraps and supports Home/End", () => {
    expect(nextIndex("ArrowDown", -1, 3)).toBe(0);
    expect(nextIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextIndex("ArrowUp", 0, 3)).toBe(2);
    expect(nextIndex("Home", 2, 3)).toBe(0);
    expect(nextIndex("End", 0, 3)).toBe(2);
    expect(nextIndex("a", 0, 3)).toBeNull();
    expect(nextIndex("ArrowDown", 0, 0)).toBeNull();
  });
});

describe("palette shortcut", () => {
  const ev = (key: string, o: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; tag: string }> = {}) => ({
    key,
    metaKey: o.metaKey ?? false,
    ctrlKey: o.ctrlKey ?? false,
    altKey: o.altKey ?? false,
    target: { tagName: o.tag ?? "BODY", isContentEditable: false } as unknown as EventTarget,
  });
  it("⌘K and Ctrl K anywhere, / only outside fields", () => {
    expect(isPaletteShortcut(ev("k", { metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(ev("K", { ctrlKey: true, tag: "INPUT" }))).toBe(true);
    expect(isPaletteShortcut(ev("/"))).toBe(true);
    expect(isPaletteShortcut(ev("/", { tag: "TEXTAREA" }))).toBe(false);
    expect(isPaletteShortcut(ev("k"))).toBe(false);
  });
});

describe("chart scale", () => {
  it("nice ticks start at 0 and cover the max", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(87)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(4200)).toEqual([0, 2000, 4000, 6000]);
    const t = niceTicks(13);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]!).toBeGreaterThanOrEqual(13);
  });
  it("formats numbers without monospace tricks", () => {
    expect(compactNumber(950)).toBe("950");
    expect(compactNumber(1250)).toBe("1.3k");
    expect(compactNumber(34_000)).toBe("34k");
    expect(compactNumber(1_500_000)).toBe("1.5M");
    expect(compactNumber(null)).toBe("–");
    expect(fullNumber(12480)).toBe("12,480");
  });
  it("stacks, percents and line points", () => {
    expect(stackTotal({ a: 2, b: 3, c: -1 }, ["a", "b", "c"])).toBe(5);
    expect(pct(50, 100)).toBe(50);
    expect(pct(5, 0)).toBe(0);
    expect(linePoints([0, 100], 100, 600, 100)).toBe("0,100 600,0");
  });
});

describe("charts (server markup)", () => {
  const series = [
    { id: "instagram", label: "Instagram", platform: "instagram" as const },
    { id: "youtube", label: "YouTube", platform: "youtube" as const },
  ];
  it("BarChart: stacked series colours, 3px tops, focusable bars, legend and hidden table", () => {
    const html = renderToStaticMarkup(
      h(BarChart, {
        data: [
          { label: "Mon", title: "Mon Nov 16", values: { instagram: 1200, youtube: 300 } },
          { label: "Tue", values: { instagram: 0, youtube: 0 }, highlight: true },
        ],
        series,
        label: "Views per day",
        unit: "views",
      }),
    );
    expect(html).toContain("bg-ds-series-instagram");
    expect(html).toContain("bg-ds-series-youtube");
    expect(html).toContain("rounded-t-ds-bar");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Mon Nov 16: 1,500 views (Instagram 1,200, YouTube 300)"');
    expect(html).toContain('<table class="sr-only">');
    expect(html).toContain(">YouTube<");
    expect(html).not.toContain("Gradient");
  });
  it("LineChart: 2px non-scaling lines per series and a legend", () => {
    const html = renderToStaticMarkup(h(LineChart, { series, values: { instagram: [1, 2, 3], youtube: [3, 2, null] }, xLabels: ["a", "b", "c"], label: "Views", unit: "views" }));
    expect(count(html, "<polyline")).toBe(2);
    expect(html).toContain('stroke-width="2"');
    expect(html).toContain('vector-effect="non-scaling-stroke"');
    expect(html).toContain("stroke-ds-series-youtube");
    expect(html).toContain('<table class="sr-only">');
  });
});

const count = (html: string, s: string) => html.split(s).length - 1;

describe("line chart scale (auto baseline, gaps)", () => {
  it("niceRange fits the axis around the data, never below 0 for counts", () => {
    expect(niceRange([1712, 1754])).toEqual([1700, 1720, 1740, 1760]);
    expect(niceRange([5, 5])[0]).toBeGreaterThanOrEqual(0);
    expect(niceRange([null])).toEqual([0, 1]);
    expect(pctIn(15, 10, 20)).toBe(50);
  });
  it("lineSegments breaks the line at nulls instead of dropping to 0", () => {
    expect(lineSegments([0, null, 100, 100], 0, 100, 300, 100)).toEqual(["0,100", "200,0 300,0"]);
  });
  it("LineChart: plot is focusable for reading values; nulls make gaps", () => {
    const html = renderToStaticMarkup(
      h(LineChart, { series: [{ id: "a", label: "A", platform: "instagram" as const }], values: { a: [1, null, 3, 4] }, xLabels: ["w", "x", "y", "z"], label: "F", unit: "followers", baseline: "auto" }),
    );
    expect(html).toContain('tabindex="0"');
    expect(count(html, "<polyline")).toBe(2);
  });
  it("LineChart: a fitted axis whose compact ticks would repeat shows full numbers", () => {
    const html = renderToStaticMarkup(h(LineChart, { series: [{ id: "a", label: "A" }], values: { a: [1282, 1371] }, xLabels: ["x", "y"], label: "F", unit: "followers", baseline: "auto" }));
    expect(html).toContain(">1,300<");
    expect(html).not.toContain(">1.3k<");
  });
});
