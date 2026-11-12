import { describe, expect, it } from "vitest";
import { pickDstWeek, simulateWeek } from "../sim/simulate-week.js";

describe("simulate-week", () => {
  it("passes a full 7-day × 4-slot week over fakes in a DST-crossing week", async () => {
    const r = await simulateWeek({ timeZone: "America/New_York", weekStart: "2026-10-26" });
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.crossesDst).toBe(true);
    expect(r.posts).toBe(7 * 4 * 3 + 7);
    expect(r.doublePosts).toBe(0);
    expect(r.capBreaches).toBe(0);
    expect(r.unknown).toBeGreaterThan(0);
    expect(r.failed).toBeGreaterThan(0);
    expect(r.recovered).toBeGreaterThanOrEqual(1);
    expect(r.summary).toMatch(/^simulate-week: OK 7d×4 slots/);
  }, 60_000);

  it("also passes in a zone without DST and with 3 slots", async () => {
    const r = await simulateWeek({ timeZone: "UTC", weekStart: "2026-11-09", cadence: { slotsPerDay: 3 } });
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.posts).toBe(7 * 3 * 3 + 7);
  }, 60_000);

  it("pickDstWeek finds a Monday whose week changes offset (or falls back to next Monday)", () => {
    const ny = pickDstWeek("America/New_York", new Date("2026-11-12T00:00:00Z"));
    expect(ny).toEqual({ weekStart: "2027-03-08", crossesDst: true });
    const utc = pickDstWeek("UTC", new Date("2026-11-12T00:00:00Z"));
    expect(utc).toEqual({ weekStart: "2026-11-16", crossesDst: false });
  });
});
