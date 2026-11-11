import { describe, expect, it } from "vitest";
import { generateCatchUpSlots } from "../catchup.js";
import type { PostingWindow } from "../types.js";

const windows: PostingWindow[] = [
  { start: "09:30", end: "11:45" },
  { start: "12:00", end: "14:00" },
  { start: "15:00", end: "18:00" },
  { start: "20:00", end: "21:00" },
];

function hhmmInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

describe("generateCatchUpSlots", () => {
  it("returns exactly `count` slots, strictly increasing, all after startFrom", () => {
    const startFrom = new Date("2026-11-11T05:00:00Z");
    const slots = generateCatchUpSlots({ count: 10, slotsPerDay: 3, windows, timeZone: "America/New_York", startFrom });
    expect(slots).toHaveLength(10);
    for (let i = 1; i < slots.length; i++) expect(slots[i]!.getTime()).toBeGreaterThan(slots[i - 1]!.getTime());
    for (const s of slots) expect(s.getTime()).toBeGreaterThan(startFrom.getTime());
  });

  it("every slot's local wall-clock time falls inside a configured window", () => {
    const startFrom = new Date("2026-11-11T05:00:00Z");
    const slots = generateCatchUpSlots({ count: 12, slotsPerDay: 3, windows, timeZone: "America/New_York", startFrom });
    for (const s of slots) {
      const hhmm = hhmmInZone(s, "America/New_York");
      const [h = 0, m = 0] = hhmm.split(":").map(Number);
      const mins = h * 60 + m;
      const inWindow = windows.some((w) => {
        const [wh = 0, wm = 0] = w.start.split(":").map(Number);
        const [eh = 0, em = 0] = w.end.split(":").map(Number);
        return mins >= wh * 60 + wm && mins <= eh * 60 + em;
      });
      expect(inWindow, `${hhmm} should be inside a window`).toBe(true);
    }
  });

  it("produces exactly slotsPerDay slots per calendar day in the target zone", () => {
    const startFrom = new Date("2026-11-11T05:00:00Z");
    const slots = generateCatchUpSlots({ count: 9, slotsPerDay: 3, windows, timeZone: "America/New_York", startFrom });
    const byDay = new Map<string, number>();
    for (const s of slots) {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(s);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    for (const n of byDay.values()) expect(n).toBeLessThanOrEqual(3);
  });

  it("handles an edge case gracefully (no windows -> empty)", () => {
    expect(generateCatchUpSlots({ count: 5, slotsPerDay: 3, windows: [], timeZone: "UTC", startFrom: new Date() })).toEqual([]);
  });

  it("is correct across a US DST transition (2027-03-14, America/New_York springs forward)", () => {
    const startFrom = new Date("2027-03-12T00:00:00Z");
    const slots = generateCatchUpSlots({ count: 20, slotsPerDay: 3, windows, timeZone: "America/New_York", startFrom });
    for (const s of slots) {
      const hhmm = hhmmInZone(s, "America/New_York");
      const [h = 0, m = 0] = hhmm.split(":").map(Number);
      const mins = h * 60 + m;
      const inWindow = windows.some((w) => {
        const [wh = 0, wm = 0] = w.start.split(":").map(Number);
        const [eh = 0, em = 0] = w.end.split(":").map(Number);
        return mins >= wh * 60 + wm && mins <= eh * 60 + em;
      });
      expect(inWindow, `${s.toISOString()} -> ${hhmm} local should be inside a window across the DST boundary`).toBe(true);
    }
  });
});
