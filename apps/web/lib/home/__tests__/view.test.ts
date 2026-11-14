import { describe, expect, it } from "vitest";
import {
  batchProgress,
  clipLength,
  heroLines,
  isoWeek,
  marqueeItems,
  markFor,
  monthMarks,
  nextPostShort,
  routeLabel,
  snapLine,
  upNextMeta,
  upNextTitle,
} from "../view.js";

describe("isoWeek", () => {
  it("matches ISO-8601 including year edges", () => {
    expect(isoWeek("2026-11-16")).toBe(47);
    expect(isoWeek("2026-01-01")).toBe(1);
    expect(isoWeek("2027-01-01")).toBe(53); // Friday → last ISO week of 2026
    expect(isoWeek("2024-12-30")).toBe(1);
  });
});

describe("batchProgress / heroLines", () => {
  it("counts approved-or-later, excludes rejected from the total", () => {
    const p = batchProgress({ draft: 2, approved: 3, queued: 1, published: 4, failed: 1, rejected: 5 });
    expect(p).toEqual({ approved: 8, total: 11, draft: 2, published: 4, attention: 1 });
  });
  it("says week, state and approved/total", () => {
    const lines = heroLines({ id: "b", weekStart: "2026-11-16", status: "approved", counts: { approved: 18, draft: 6 } });
    expect(lines.map((l) => l.text)).toEqual(["Week 47", "approved", "18/24"]);
    expect(heroLines({ id: "b", weekStart: "2026-11-16", status: "draft", counts: {} })[1]!.text).toBe("in draft");
  });
  it("has an honest empty hero", () => {
    expect(heroLines(null).map((l) => l.text)).toEqual(["Nothing", "drafted", "yet"]);
  });
});

describe("up next", () => {
  const at = new Date("2026-11-16T09:00:00Z");
  it("formats meta in the creator zone, or labelled UTC when unset", () => {
    expect(upNextMeta({ platform: "instagram", scheduledFor: at, durationS: 42 }, "UTC")).toBe("MON 16 NOV · 09:00 · REEL · 0:42");
    expect(upNextMeta({ platform: "youtube", scheduledFor: at, durationS: null }, null)).toBe("MON 16 NOV · 09:00 UTC · SHORT");
    expect(upNextMeta({ platform: "tiktok", scheduledFor: at, durationS: 65 }, "Etc/GMT-2")).toBe("MON 16 NOV · 11:00 · VIDEO · 1:05");
    expect(nextPostShort({ platform: "snapchat", scheduledFor: at }, "UTC")).toBe("09:00 · SC");
    expect(nextPostShort(undefined, "UTC")).toBe("—");
  });
  it("titles from the YouTube title, else the caption's first words without tags, mentions or links", () => {
    expect(upNextTitle("Rest-day meals", "ignored")).toBe("Rest-day meals");
    expect(upNextTitle(null, "Morning stretch #mobility @someone https://x.example/y\nsecond line")).toBe("Morning stretch");
    expect(upNextTitle(null, "Three minutes, no equipment, and your back will thank you")).toBe("Three minutes, no equipment…");
    expect(upNextTitle(null, "  #onlytags ")).toBe("Untitled clip");
    expect(upNextTitle("", null)).toBe("Untitled clip");
  });
  it("clipLength", () => {
    expect(clipLength(0)).toBe("0:00");
    expect(clipLength(59.6)).toBe("1:00");
    expect(clipLength(null)).toBe("");
  });
});

describe("monthMarks", () => {
  it("marks this local month only, warn first, max 3 a day", () => {
    const d = (s: string) => new Date(s);
    const rows = [
      { scheduledFor: d("2026-11-16T09:00:00Z"), status: "approved" },
      { scheduledFor: d("2026-11-16T10:00:00Z"), status: "published" },
      { scheduledFor: d("2026-11-16T11:00:00Z"), status: "queued" },
      { scheduledFor: d("2026-11-16T12:00:00Z"), status: "unknown" },
      { scheduledFor: d("2026-11-20T12:00:00Z"), status: "draft" },
      { scheduledFor: d("2026-12-01T12:00:00Z"), status: "approved" },
    ];
    const m = monthMarks(rows, d("2026-11-14T12:00:00Z"), null);
    expect(m).toMatchObject({ year: 2026, month0: 10, today: 14 });
    expect(m.marks).toEqual({ 16: ["warn", "accent", "accent"] });
    expect(markFor("rejected")).toBeNull();
  });
});

describe("labels", () => {
  it("routeLabel / snapLine / marquee", () => {
    expect(routeLabel({ route: "direct", scheduling: "server-fires" })).toBe("DIRECT · SERVER FIRES");
    expect(routeLabel({ route: "assisted", scheduling: "none" })).toBe("ASSISTED · TAP TO SHARE");
    expect(snapLine(null)).toBe("TZ_CREATOR not set");
    expect(snapLine(1)).toBe("1 to share today");
    expect(snapLine(0)).toBe("0 to share today");
    const mq = marqueeItems(["instagram", "youtube"], { id: "b", weekStart: "2026-11-16", status: "approved", counts: {} });
    expect(mq.map((i) => i.text)).toEqual(["Instagram", "YouTube", "Week 47", "approved"]);
    expect(marqueeItems(["tiktok"], null)).toEqual([{ text: "TikTok", style: "stroke" }]);
  });
});
