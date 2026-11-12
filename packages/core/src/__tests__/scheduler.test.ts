import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE, daySlotTimes, isWithinAnyWindow, normalizeCadence } from "../cadence.js";
import { assignSlots, findCapBreaches, type ScheduleItem } from "../scheduler.js";
import { addCalendarDays, localDate, localHHMM } from "../time.js";

const TZ = "America/New_York"; // fixture zone (DST-observing), not the creator's
const cadence = DEFAULT_CADENCE;

function clips(n: number, platforms: ScheduleItem["platforms"] = ["instagram", "youtube", "tiktok"]): ScheduleItem[] {
  return Array.from({ length: n }, (_, i) => ({ key: `clip-${i + 1}`, pillar: "gym", platforms }));
}

describe("assignSlots", () => {
  it("places 7×4 clips on the grid: 4 IG anchors a day, every slot inside a window", () => {
    const r = assignSlots({ weekStart: "2026-11-09", items: clips(28), cadence, timeZone: TZ });
    expect(r.unplaced).toEqual([]);
    expect(r.assignments).toHaveLength(84);
    const grid = daySlotTimes(cadence);
    for (const a of r.assignments) {
      const hhmm = localHHMM(new Date(a.scheduledFor), TZ);
      expect(grid, `${a.key}/${a.platform} at ${hhmm}`).toContain(hhmm);
      expect(isWithinAnyWindow(hhmm, cadence.windows)).toBe(true);
    }
    const igDays = new Map<string, number>();
    for (const a of r.assignments) if (a.platform === "instagram") igDays.set(a.localDate, (igDays.get(a.localDate) ?? 0) + 1);
    expect([...igDays.values()]).toEqual([4, 4, 4, 4, 4, 4, 4]);
    expect(findCapBreaches(r.assignments, cadence, TZ)).toEqual([]);
  });

  it("staggers one video: YouTube next slot, TikTok next day, Snapchat two days later", () => {
    const r = assignSlots({ weekStart: "2026-11-09", items: [{ key: "v", platforms: ["instagram", "youtube", "tiktok", "snapchat"] }], cadence, timeZone: TZ });
    const by = Object.fromEntries(r.assignments.map((a) => [a.platform, a]));
    expect(by.instagram!.localDate).toBe("2026-11-09");
    expect(by.instagram!.slotIndex).toBe(0);
    expect(by.youtube!.localDate).toBe("2026-11-09");
    expect(by.youtube!.slotIndex).toBe(1);
    expect(by.tiktok!.localDate).toBe("2026-11-10");
    expect(by.tiktok!.slotIndex).toBe(0);
    expect(by.snapchat!.localDate).toBe("2026-11-11");
  });

  it("never exceeds a per-platform daily cap, counting existing commitments", () => {
    const existing = [
      { platform: "instagram" as const, scheduledFor: "2026-11-09T15:00:00Z" },
      { platform: "instagram" as const, scheduledFor: "2026-11-09T16:00:00Z" },
      { platform: "instagram" as const, scheduledFor: "2026-11-09T17:00:00Z" },
    ];
    const r = assignSlots({ weekStart: "2026-11-09", items: clips(25, ["instagram"]), cadence, timeZone: TZ, existing });
    const all = [...existing, ...r.assignments];
    expect(findCapBreaches(all, cadence, TZ)).toEqual([]);
    expect(r.unplaced).toEqual([]);
    const monday = r.assignments.filter((a) => a.localDate === "2026-11-09");
    expect(monday).toHaveLength(1); // 3 existing + 1 = cap 4; the other 24 fill Tue..Sun
  });

  it("refuses the same video twice on one platform", () => {
    const r = assignSlots({ weekStart: "2026-11-09", items: [{ key: "v", platforms: ["instagram"] }, { key: "v", platforms: ["instagram", "tiktok"] }], cadence, timeZone: TZ });
    expect(r.unplaced).toEqual([{ key: "v", platform: "instagram", reason: "duplicate", detail: expect.any(String) }]);
    expect(r.assignments.map((a) => a.platform).sort()).toEqual(["instagram", "tiktok"]);
  });

  it("keeps pinned times, counts them toward caps, and refuses a pinned time that breaks the cap", () => {
    const pin = "2026-11-10T18:00:00Z";
    const r = assignSlots({
      weekStart: "2026-11-09",
      items: [{ key: "a", platforms: ["instagram"], pinned: { instagram: pin } }, { key: "b", platforms: ["instagram"], pinned: { instagram: pin } }],
      cadence: normalizeCadence({ dailyCaps: { instagram: 1 } }),
      timeZone: TZ,
    });
    expect(r.assignments).toEqual([expect.objectContaining({ key: "a", pinned: true, scheduledFor: "2026-11-10T18:00:00.000Z", slotIndex: -1 })]);
    expect(r.unplaced[0]).toMatchObject({ key: "b", reason: "pinned-cap" });
  });

  it("applies the per-pillar buffer from the captured date (default off)", () => {
    const captured = "2026-11-10T20:00:00Z"; // Tue evening local
    const off = assignSlots({ weekStart: "2026-11-09", items: [{ key: "g", pillar: "gym", platforms: ["instagram"], capturedAt: captured }], cadence, timeZone: TZ });
    expect(off.assignments[0]!.localDate).toBe("2026-11-09"); // no buffer: earliest day
    const on = assignSlots({ weekStart: "2026-11-09", items: [{ key: "g", pillar: "gym", platforms: ["instagram"], capturedAt: captured }], cadence: normalizeCadence({ bufferDays: { gym: 2 } }), timeZone: TZ });
    expect(on.assignments[0]!.localDate).toBe("2026-11-12"); // captured Tue + 2 days = Thu
    const past = assignSlots({ weekStart: "2026-11-09", items: [{ key: "g", pillar: "gym", platforms: ["instagram"], capturedAt: captured }], cadence: normalizeCadence({ bufferDays: { gym: 10 } }), timeZone: TZ });
    expect(past.unplaced[0]).toMatchObject({ reason: "buffer" });
  });

  it("skips slots at or before `now`", () => {
    const now = new Date("2026-11-09T20:00:00Z"); // Monday 15:00 local: the 10:38 and 13:00 slots are gone
    const r = assignSlots({ weekStart: "2026-11-09", items: clips(1, ["instagram"]), cadence, timeZone: TZ, now });
    expect(r.assignments[0]!.localDate).toBe("2026-11-09");
    expect(r.assignments[0]!.slotIndex).toBe(2);
  });

  it("keeps wall-clock slot times through a DST change (fall-back week)", () => {
    const weekStart = "2026-10-26"; // US fall-back on 2026-11-01 (Sunday of this week)
    const r = assignSlots({ weekStart, items: clips(28), cadence, timeZone: TZ });
    const grid = daySlotTimes(cadence);
    for (const a of r.assignments) expect(grid).toContain(localHHMM(new Date(a.scheduledFor), TZ));
    const sundayIG = r.assignments.filter((a) => a.platform === "instagram" && a.localDate === "2026-11-01").map((a) => a.scheduledFor);
    expect(sundayIG).toHaveLength(4);
    // After the change the same wall-clock slot is one UTC hour later than the day before.
    const satIG = r.assignments.filter((a) => a.platform === "instagram" && a.localDate === "2026-10-31").map((a) => a.scheduledFor);
    expect(Date.parse(sundayIG[0]!) - Date.parse(satIG[0]!)).toBe(25 * 3_600_000);
  });

  it("falls back to the first wanted platform as anchor when Instagram isn't wanted", () => {
    const r = assignSlots({ weekStart: "2026-11-09", items: [{ key: "y", platforms: ["youtube", "tiktok"] }], cadence, timeZone: TZ });
    const by = Object.fromEntries(r.assignments.map((a) => [a.platform, a]));
    expect(by.youtube!.localDate).toBe("2026-11-09");
    expect(by.tiktok!.localDate).toBe(addCalendarDays(by.youtube!.localDate, 1));
  });

  it("findCapBreaches reports the day and count over the cap in the creator's zone", () => {
    const posts = Array.from({ length: 5 }, (_, i) => ({ platform: "tiktok" as const, scheduledFor: `2026-11-10T${15 + i}:00:00Z` }));
    expect(findCapBreaches(posts, cadence, TZ)).toEqual([{ platform: "tiktok", localDate: localDate(new Date(posts[0]!.scheduledFor), TZ), count: 5, cap: 4 }]);
  });
});
