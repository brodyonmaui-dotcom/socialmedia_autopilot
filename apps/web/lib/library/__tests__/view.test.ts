import { describe, expect, it } from "vitest";
import {
  basename,
  cellIndex,
  durationLabel,
  filterClips,
  gridHead,
  heroLines,
  libraryHref,
  parseQuery,
  pillarCounts,
  pillarSummary,
  sizeLabel,
  statusBadge,
  warningsOf,
  type ClipRow,
} from "../view.js";

const row = (o: Partial<ClipRow>): ClipRow => ({ id: "x", pillar: "gym", duration_s: "42", qa: null, source_path: "demo/a.mp4", status: "used", ...o });

describe("library view", () => {
  it("basename handles both separators", () => {
    expect(basename("C:\\demo\\clip-1.mp4")).toBe("clip-1.mp4");
    expect(basename("demo/sub/clip-2.mp4")).toBe("clip-2.mp4");
    expect(basename("plain.mp4")).toBe("plain.mp4");
  });

  it("durationLabel formats m:ss and guards bad input", () => {
    expect(durationLabel("42")).toBe("0:42");
    expect(durationLabel(66.4)).toBe("1:06");
    expect(durationLabel(59.6)).toBe("1:00");
    expect(durationLabel(null)).toBe("—");
    expect(durationLabel("abc")).toBe("—");
    expect(durationLabel(-1)).toBe("—");
  });

  it("sizeLabel needs both sides", () => {
    expect(sizeLabel(1080, 1920)).toBe("1080×1920");
    expect(sizeLabel(null, 1920)).toBeNull();
  });

  it("warningsOf keeps non-empty strings only", () => {
    expect(warningsOf({ qa: { warnings: ["shaky", "", "  ", 3 as unknown as string] } })).toEqual(["shaky"]);
    expect(warningsOf({ qa: null })).toEqual([]);
  });

  it("statusBadge maps ready to accent, qa_fail to warn, never green", () => {
    expect(statusBadge("ready")).toEqual({ label: "Ready", tone: "accent" });
    expect(statusBadge("qa_fail").tone).toBe("warn");
    expect(statusBadge("used").tone).toBe("neutral");
    expect(statusBadge("weird_state")).toEqual({ label: "weird state", tone: "neutral" });
    expect(statusBadge(undefined).label).toBe("Unknown");
  });

  it("parseQuery trims, takes the first value and caps length", () => {
    expect(parseQuery("  gym ")).toBe("gym");
    expect(parseQuery(["a", "b"])).toBe("a");
    expect(parseQuery(undefined)).toBe("");
    expect(parseQuery("x".repeat(200))).toHaveLength(80);
  });

  it("filterClips matches every term across name, pillar, status and warnings", () => {
    const rows = [
      row({ id: "1", source_path: "demo/leg-day.mp4", pillar: "gym" }),
      row({ id: "2", source_path: "demo/oats.mp4", pillar: "meal", status: "ready", qa: { warnings: ["Audio clipping"] } }),
      row({ id: "3", source_path: "demo/chart.mp4", pillar: null }),
    ];
    expect(filterClips(rows, "")).toHaveLength(3);
    expect(filterClips(rows, "GYM").map((r) => r.id)).toEqual(["1"]);
    expect(filterClips(rows, "meal clipping").map((r) => r.id)).toEqual(["2"]);
    expect(filterClips(rows, "meal leg")).toEqual([]);
    expect(filterClips(rows, "ready").map((r) => r.id)).toEqual(["2"]);
  });

  it("heroLines puts the count last as solid", () => {
    expect(heroLines(56)).toEqual([
      { text: "Library", style: "stroke" },
      { text: "in stock", style: "serif" },
      { text: "56", style: "solid" },
    ]);
    expect(heroLines(-3)[2].text).toBe("0");
  });

  it("pillarCounts / pillarSummary sort by size and cap", () => {
    const rows = [{ pillar: "tip" }, { pillar: "gym" }, { pillar: "gym" }, { pillar: null }, { pillar: "meal" }];
    expect(pillarCounts(rows)).toEqual([
      { pillar: "gym", n: 2 },
      { pillar: "meal", n: 1 },
      { pillar: "tip", n: 1 },
      { pillar: "unsorted", n: 1 },
    ]);
    expect(pillarSummary(rows, 2)).toBe("gym 2 · meal 1 · +2 more");
    expect(pillarSummary([])).toBe("—");
  });

  it("gridHead switches to search copy", () => {
    expect(gridHead("", 56, 56)).toEqual({ title: "All", serif: "clips", meta: "56 clips" });
    expect(gridHead("gym", 1, 56).meta).toBe("1 of 56 · “gym”");
  });

  it("cellIndex and libraryHref", () => {
    expect(cellIndex(0)).toBe("01");
    expect(cellIndex(99)).toBe("100");
    expect(libraryHref("C:\\x\\leg day.mp4")).toBe("/library?q=leg%20day.mp4");
  });
});
