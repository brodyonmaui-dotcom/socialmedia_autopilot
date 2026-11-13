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

  // F7 E6: the two fault types the first sim didn't inject.
  it("injects YouTube 503-after-upload (→ unknown, never resent) and IG caption normalisation (→ found, not resent)", async () => {
    const r = await simulateWeek({ timeZone: "UTC", weekStart: "2026-11-09" });
    const byName = (n: string) => r.checks.find((c) => c.name === n);
    expect(byName("youtube error after upload started → unknown, never resent")).toMatchObject({ ok: true });
    expect(byName("instagram existence check finds a caption IG rewrote → no resend")).toMatchObject({ ok: true });
    expect(r.faults.youtubeUploadAmbiguous).toBeGreaterThanOrEqual(2);
    expect(r.faults.instagramNormalisedCaption).toBeGreaterThanOrEqual(2);
    expect(r.doublePosts).toBe(0);
    expect(r.summary).toMatch(/yt-503 \d+ · ig-normalised \d+/);
  }, 60_000);

  it("the IG fault bites: an exact-caption lookup would double-post (so the check is meaningful)", async () => {
    const r = await simulateWeek({ timeZone: "UTC", weekStart: "2026-11-09", exactCaptionLookup: true });
    expect(r.doublePosts).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
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
