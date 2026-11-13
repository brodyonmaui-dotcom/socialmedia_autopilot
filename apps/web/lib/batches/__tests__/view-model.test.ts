import { describe, expect, it } from "vitest";
import { planTransition } from "../transitions.js";
import { batchStatusOf, confirmCounts, dayLabel, formatDuration, fromDatetimeLocal, groupByLocalDay, summaryCounts, toDatetimeLocal, weekLabel } from "../view-model.js";
import { countByStatus } from "../types.js";
import { makeBatch, makeItem, NOW } from "./fixtures.js";

// Fixture zone only (never the creator's): UK clocks go back on Sun 25 Oct 2026 at 02:00 BST → 01:00 GMT.
const TZ = "Europe/London";

describe("groupByLocalDay", () => {
  it("groups by creator-local day across the DST change, untimed first, days in order", () => {
    const sat = makeItem({ scheduledFor: "2026-10-24T22:30:00.000Z" }); // Sat 23:30 BST
    const sunEarly = makeItem({ scheduledFor: "2026-10-24T23:30:00.000Z" }); // Sun 00:30 BST (UTC still Saturday)
    const sunLate = makeItem({ scheduledFor: "2026-10-25T23:30:00.000Z" }); // Sun 23:30 GMT
    const mon = makeItem({ scheduledFor: "2026-10-26T00:30:00.000Z" }); // Mon 00:30 GMT
    const none = makeItem({ scheduledFor: null });
    const g = groupByLocalDay([mon, sunLate, none, sat, sunEarly], TZ, "2026-10-19");
    expect(g.untimed.map((i) => i.id)).toEqual([none.id]);
    expect(g.days.map((d) => d.date)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"]);
    const day = (d: string) => g.days.find((x) => x.date === d)!;
    expect(day("2026-10-24").items.map((x) => [x.item.id, x.time])).toEqual([[sat.id, "23:30"]]);
    expect(day("2026-10-25").items.map((x) => [x.item.id, x.time])).toEqual([
      [sunEarly.id, "00:30"],
      [sunLate.id, "23:30"],
    ]);
    expect(day("2026-10-26").items.map((x) => x.time)).toEqual(["00:30"]);
    expect(day("2026-10-19").items).toEqual([]);
    expect(day("2026-10-25").label).toBe("Sun 25 Oct");
  });

  it("sorts within a day by time", () => {
    const late = makeItem({ scheduledFor: "2026-11-18T20:00:00.000Z" });
    const early = makeItem({ scheduledFor: "2026-11-18T09:30:00.000Z" });
    const g = groupByLocalDay([late, early], "UTC", "2026-11-16");
    expect(g.days[2]!.items.map((x) => x.item.id)).toEqual([early.id, late.id]);
  });
});

describe("datetime-local", () => {
  it("round trips through the zone, both sides of the DST change", () => {
    for (const iso of ["2026-10-24T22:30:00.000Z", "2026-10-25T12:15:00.000Z", "2026-07-01T08:00:00.000Z"]) {
      expect(fromDatetimeLocal(toDatetimeLocal(iso, TZ), TZ)).toBe(iso);
    }
    expect(toDatetimeLocal("2026-07-01T08:00:00.000Z", TZ)).toBe("2026-07-01T09:00");
    expect(fromDatetimeLocal("2026-12-01T09:00", TZ)).toBe("2026-12-01T09:00:00.000Z");
    expect(fromDatetimeLocal("2026-07-01T09:00", TZ)).toBe("2026-07-01T08:00:00.000Z");
  });

  it("handles empty and malformed values", () => {
    expect(toDatetimeLocal(null, TZ)).toBe("");
    expect(fromDatetimeLocal("", TZ)).toBeNull();
    expect(fromDatetimeLocal("tomorrow", TZ)).toBeNull();
    expect(fromDatetimeLocal("2026-02-31T09:00", TZ)).toBeNull();
  });
});

describe("confirmCounts", () => {
  it("counts approvable, blocked and warnings from the approve-all plan", () => {
    const warn = { code: "media.qa" as const, severity: "warn" as const, message: "media QA: dark" };
    const block = { code: "time.past" as const, severity: "block" as const, message: "time is in the past" };
    const items = [makeItem({ warnings: [warn, warn] }), makeItem(), makeItem({ warnings: [block, warn] }), makeItem({ status: "published" })];
    const batch = makeBatch(items);
    const c = confirmCounts(items, planTransition(batch, { kind: "approve-all" }, NOW));
    expect(c).toEqual({ approvable: 2, blocked: 1, warnCount: 2, skipped: [{ itemId: items[2]!.id, reasons: ["time is in the past"] }] });
    expect(confirmCounts(items, { ok: false, reason: "x" })).toMatchObject({ approvable: 0, blocked: 0 });
  });
});

describe("small helpers", () => {
  it("formats, labels and summarises", () => {
    expect(formatDuration(42)).toBe("0:42");
    expect(formatDuration(65.4)).toBe("1:05");
    expect(formatDuration(null)).toBe("");
    expect(dayLabel("2026-11-16")).toBe("Mon 16 Nov");
    expect(weekLabel("2026-11-16", NOW)).toBe("Mon 16 Nov");
    expect(weekLabel("2099-01-05", NOW)).toBe("Mon 5 Jan 2099");
    expect(batchStatusOf([{ status: "draft" }, { status: "rejected" }])).toBe("draft");
    expect(batchStatusOf([{ status: "draft" }, { status: "queued" }])).toBe("approved");
    const counts = countByStatus([{ status: "draft" }, { status: "queued" }, { status: "failed" }, { status: "published" }]);
    expect(summaryCounts(counts)).toEqual({ draft: 1, approved: 0, published: 1, rejected: 0, other: 2 });
  });
});
