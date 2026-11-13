import { describe, expect, it } from "vitest";
import { NEGATIVE_POOL, POSITIVE_POOL } from "../pools.js";
import { DEFAULT_ENGAGEMENT, normalizeEngagement } from "../settings.js";

describe("DEFAULT_ENGAGEMENT", () => {
  it("matches the run-2 decisions", () => {
    expect(DEFAULT_ENGAGEMENT.mode).toEqual({ instagram: "shadow", youtube: "shadow", tiktok: "off" });
    expect(DEFAULT_ENGAGEMENT.killed).toBe(false);
    expect(DEFAULT_ENGAGEMENT.hideEnabled).toEqual({ instagram: false, youtube: false, tiktok: false });
    expect(DEFAULT_ENGAGEMENT.limits).toEqual({ perPersonDays: 7, perPlatformPerHour: 10, perPlatformPerDay: 40, globalPerDay: 80 });
    expect(DEFAULT_ENGAGEMENT.minDelayMin).toBe(10);
    expect(DEFAULT_ENGAGEMENT.pollMinutes).toEqual({ instagram: 5, youtube: 15 });
    expect(DEFAULT_ENGAGEMENT.pools).toEqual({ positive: [...POSITIVE_POOL], negative: [...NEGATIVE_POOL] });
    expect(DEFAULT_ENGAGEMENT.dmPollVerified).toBe(false);
  });
});

describe("normalizeEngagement", () => {
  it("returns the defaults for empty / non-object input, as a fresh copy", () => {
    for (const input of [undefined, null, {}, "x", 3, []]) expect(normalizeEngagement(input)).toEqual(DEFAULT_ENGAGEMENT);
    const out = normalizeEngagement({});
    out.pools.positive.push("mutated");
    out.mode.instagram = "live";
    expect(DEFAULT_ENGAGEMENT.pools.positive).not.toContain("mutated");
    expect(DEFAULT_ENGAGEMENT.mode.instagram).toBe("shadow");
  });

  it("deep-merges a partial overlay", () => {
    const out = normalizeEngagement({
      mode: { instagram: "live" },
      killed: true,
      killedReason: "manual",
      hideEnabled: { youtube: true },
      limits: { perPlatformPerHour: 5 },
      pollMinutes: { youtube: 30 },
      pools: { negative: ["Have a good one"] },
      dmPollVerified: true,
      somethingElse: 1,
    });
    expect(out.mode).toEqual({ instagram: "live", youtube: "shadow", tiktok: "off" });
    expect(out.killed).toBe(true);
    expect(out.killedReason).toBe("manual");
    expect(out.hideEnabled).toEqual({ instagram: false, youtube: true, tiktok: false });
    expect(out.limits).toEqual({ ...DEFAULT_ENGAGEMENT.limits, perPlatformPerHour: 5 });
    expect(out.pollMinutes).toEqual({ instagram: 5, youtube: 30 });
    expect(out.pools).toEqual({ positive: [...POSITIVE_POOL], negative: ["Have a good one"] });
    expect(out.dmPollVerified).toBe(true);
    expect(out).not.toHaveProperty("somethingElse");
  });

  it("falls back on bad values and clamps numbers", () => {
    const out = normalizeEngagement({
      mode: { instagram: "LIVE", youtube: 1, tiktok: "live" },
      killed: "yes",
      hideEnabled: { instagram: "true" },
      limits: { perPersonDays: -3, perPlatformPerHour: "10", perPlatformPerDay: Number.NaN, globalPerDay: 0 },
      minDelayMin: 0,
      pollMinutes: { instagram: -5, youtube: null },
      pools: { positive: [], negative: ["ok", 3] },
      dmPollVerified: 1,
    });
    expect(out.mode).toEqual({ instagram: "shadow", youtube: "shadow", tiktok: "live" });
    expect(out.killed).toBe(false);
    expect(out.hideEnabled.instagram).toBe(false);
    expect(out.limits).toEqual({ perPersonDays: 0, perPlatformPerHour: 10, perPlatformPerDay: 40, globalPerDay: 0 });
    expect(out.minDelayMin).toBe(1);
    expect(out.pollMinutes).toEqual({ instagram: 1, youtube: 15 });
    expect(out.pools).toEqual(DEFAULT_ENGAGEMENT.pools);
    expect(out.dmPollVerified).toBe(false);
  });

  it("merges onto a custom base", () => {
    const base = normalizeEngagement({ minDelayMin: 20 });
    expect(normalizeEngagement({ killed: true }, base).minDelayMin).toBe(20);
  });
});
