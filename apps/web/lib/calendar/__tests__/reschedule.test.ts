import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE, findCapBreaches, type CadenceSettings, type Platform } from "@autopilot/core";
import { planReschedule, safeReturnTo, type RescheduleCandidate } from "../reschedule.js";

// Pure planner. UTC keeps the arithmetic readable; DEFAULT_CADENCE slots are 10:38, 13:00, 16:30, 20:30.
const TZ = "UTC";
const NOW = new Date("2097-08-12T12:00:00.000Z");
const cadence: CadenceSettings = { ...DEFAULT_CADENCE, dailyCaps: { ...DEFAULT_CADENCE.dailyCaps } };
let n = 0;
const item = (o: Partial<RescheduleCandidate> & { platform?: Platform } = {}): RescheduleCandidate => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  platform: "instagram",
  status: "approved",
  batchStatus: "approved",
  scheduledFor: "2097-08-10T10:00:00.000Z",
  title: null,
  caption: "Morning stretch",
  ...o,
});
const plan = (items: RescheduleCandidate[], existing: Array<{ platform: Platform; scheduledFor: string }> = [], c = cadence) =>
  planReschedule(items, { now: NOW, timeZone: TZ, cadence: c, existing });

describe("planReschedule", () => {
  it("series first (key, then day), then evergreen by original time; Day 11 never before Day 10", () => {
    const evergreen = item({ caption: "Morning stretch", scheduledFor: "2097-08-10T08:00:00.000Z" });
    const day11 = item({ caption: "Day 11 of the climb", scheduledFor: "2097-08-10T09:00:00.000Z" });
    const day10 = item({ caption: "Day 10 of the climb", scheduledFor: "2097-08-10T10:00:00.000Z" });
    const rows = plan([evergreen, day11, day10]);
    expect(rows.map((r) => r.id)).toEqual([day10.id, day11.id, evergreen.id]);
    expect(rows.map((r) => r.to)).toEqual(["2097-08-12T13:00:00.000Z", "2097-08-12T16:30:00.000Z", "2097-08-12T20:30:00.000Z"]);
    expect(rows[0]).toMatchObject({ from: "2097-08-10T10:00:00.000Z", series: { key: "climb", day: 10 }, title: "Day 10 of the climb" });
    expect(rows[2]!.series).toBeNull();
  });

  it("Day N+1 never lands before Day N on a platform, whatever is already booked", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 25; run++) {
      const existing = Array.from({ length: 12 }, () => ({ platform: "instagram" as const, scheduledFor: new Date(NOW.getTime() + Math.floor(rand() * 7 * 24 * 4) * 15 * 60_000).toISOString() }));
      const days = [5, 3, 6, 1, 4, 2].map((d) => item({ caption: `Day ${d} of the climb`, scheduledFor: new Date(NOW.getTime() - (2 + rand() * 48) * 3_600_000).toISOString() }));
      const rows = plan(days, existing).filter((r) => r.to);
      expect(rows.map((r) => r.series!.day)).toEqual([1, 2, 3, 4, 5, 6].slice(0, rows.length));
      for (let i = 1; i < rows.length; i++) expect(Date.parse(rows[i]!.to!)).toBeGreaterThan(Date.parse(rows[i - 1]!.to!));
      for (const r of rows) for (const e of existing) expect(Math.abs(Date.parse(r.to!) - Date.parse(e.scheduledFor))).toBeGreaterThanOrEqual(cadence.minGapMinutes * 60_000);
    }
  });

  it("uses the title over the caption for the series and label", () => {
    const yt = item({ platform: "youtube", title: "Day 4 of the climb", caption: "a long description" });
    expect(plan([yt])[0]).toMatchObject({ series: { key: "climb", day: 4 }, title: "Day 4 of the climb" });
  });

  it("starts 10 minutes out and respects caps and gaps against existing posts and its own assignments", () => {
    const c: CadenceSettings = { ...cadence, dailyCaps: { ...cadence.dailyCaps, tiktok: 1 } };
    // Today (2097-08-12) already has its one TikTok, so the first goes tomorrow and the second (its own assignment counted) the day after.
    const rows = plan([item({ platform: "tiktok" }), item({ platform: "tiktok", scheduledFor: "2097-08-10T11:00:00.000Z" })], [{ platform: "tiktok", scheduledFor: "2097-08-12T09:00:00.000Z" }], c);
    expect(rows.map((r) => r.to)).toEqual(["2097-08-13T10:38:00.000Z", "2097-08-14T10:38:00.000Z"]);
    const all = [{ platform: "tiktok" as const, scheduledFor: "2097-08-12T09:00:00.000Z" }, ...rows.map((r) => ({ platform: r.platform, scheduledFor: r.to! }))];
    expect(findCapBreaches(all, c, TZ)).toEqual([]);
  });

  it("platforms don't block each other", () => {
    const rows = plan([item({ platform: "instagram" }), item({ platform: "youtube" })]);
    expect(rows.map((r) => r.to)).toEqual(["2097-08-12T13:00:00.000Z", "2097-08-12T13:00:00.000Z"]);
  });

  it("no free slot inside 7 days → no-slot, nothing assigned", () => {
    const c: CadenceSettings = { ...cadence, dailyCaps: { ...cadence.dailyCaps, youtube: 0 } };
    expect(plan([item({ platform: "youtube" })], [], c)[0]).toMatchObject({ to: null, reason: "no-slot" });
  });

  it("anything not missed is left alone: draft, published, within the hour, Snapchat, unapproved batch, no time", () => {
    const rows = plan([
      item({ status: "draft" }),
      item({ status: "published" }),
      item({ scheduledFor: "2097-08-12T11:01:00.000Z" }),
      item({ platform: "snapchat" }),
      item({ batchStatus: "draft" }),
      item({ scheduledFor: null }),
    ]);
    expect(rows.every((r) => r.to === null && r.reason === "not-missed")).toBe(true);
    expect(rows).toHaveLength(6);
  });

  it("a missed post an hour and a minute late moves", () => {
    expect(plan([item({ scheduledFor: "2097-08-12T10:59:00.000Z" })])[0]!.to).toBe("2097-08-12T13:00:00.000Z");
  });
});

describe("safeReturnTo", () => {
  it("keeps same-origin relative paths, else /calendar", () => {
    expect(safeReturnTo("/calendar?d=2097-08-12")).toBe("/calendar?d=2097-08-12");
    expect(safeReturnTo("/")).toBe("/");
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "calendar", "/a b", "", null, 42, "/" + "x".repeat(600)]) {
      expect(safeReturnTo(bad)).toBe("/calendar");
    }
  });
});
