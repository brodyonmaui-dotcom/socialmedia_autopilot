import { describe, expect, it } from "vitest";
import { CAP_LIMITS, DEFAULT_CADENCE, daySlotTimes, normalizeCadence } from "../cadence.js";

describe("normalizeCadence", () => {
  it("returns the defaults for an empty or missing value", () => {
    expect(normalizeCadence(undefined)).toEqual(DEFAULT_CADENCE);
    expect(normalizeCadence({})).toEqual(DEFAULT_CADENCE);
  });

  it("merges a partial override and keeps the rest", () => {
    const c = normalizeCadence({ dailyCaps: { tiktok: 2 }, stagger: { tiktok: { days: 2 } }, bufferDays: { gym: 1 } });
    expect(c.dailyCaps).toEqual({ ...DEFAULT_CADENCE.dailyCaps, tiktok: 2 });
    expect(c.stagger.tiktok).toEqual({ days: 2, slots: 0 });
    expect(c.bufferDays.gym).toBe(1);
    expect(c.windows).toEqual(DEFAULT_CADENCE.windows);
  });

  it("instagram always anchors at offset zero", () => {
    expect(normalizeCadence({ stagger: { instagram: { days: 3, slots: 2 } } }).stagger.instagram).toEqual({ days: 0, slots: 0 });
  });

  it("rejects impossible settings instead of producing a broken grid", () => {
    expect(() => normalizeCadence({ windows: [] })).toThrow(/at least one window/);
    expect(() => normalizeCadence({ windows: [{ start: "10:00", end: "09:00" }] })).toThrow(/invalid window/);
    expect(() => normalizeCadence({ windows: [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "13:00" }] })).toThrow(/overlap/);
    expect(() => normalizeCadence({ slotsPerDay: 0 })).toThrow(/slotsPerDay/);
    expect(() => normalizeCadence({ dailyCaps: { instagram: -1 } })).toThrow(/dailyCaps/);
    expect(() => normalizeCadence({ stagger: { tiktok: { days: 30 } } })).toThrow(/stagger/);
    expect(() => normalizeCadence({ bufferDays: { gym: 99 } })).toThrow(/bufferDays/);
  });
});

describe("daily caps (F15)", () => {
  it("defaults to 5/day IG/YT/TikTok and 1 Snapchat", () => {
    expect(DEFAULT_CADENCE.dailyCaps).toEqual({ instagram: 5, youtube: 5, tiktok: 5, snapchat: 1 });
  });

  it("a stored cadence row with caps 4 still yields 4", () => {
    expect(normalizeCadence({ dailyCaps: { instagram: 4, youtube: 4, tiktok: 4, snapchat: 1 } }).dailyCaps).toEqual({ instagram: 4, youtube: 4, tiktok: 4, snapchat: 1 });
  });

  it("accepts a cap at the limit and throws on a cap above CAP_LIMITS", () => {
    expect(CAP_LIMITS).toEqual({ instagram: 25, youtube: 10, tiktok: 15, snapchat: 1 });
    expect(normalizeCadence({ dailyCaps: { ...CAP_LIMITS } }).dailyCaps).toEqual(CAP_LIMITS);
    expect(() => normalizeCadence({ dailyCaps: { instagram: 26 } })).toThrow(/dailyCaps.instagram/);
    expect(() => normalizeCadence({ dailyCaps: { youtube: 11 } })).toThrow(/dailyCaps.youtube/);
    expect(() => normalizeCadence({ dailyCaps: { tiktok: 16 } })).toThrow(/dailyCaps.tiktok/);
    expect(() => normalizeCadence({ dailyCaps: { snapchat: 2 } })).toThrow(/dailyCaps.snapchat/);
  });
});

describe("daySlotTimes", () => {
  it("spreads 4 slots across the default windows, one per window", () => {
    const t = daySlotTimes(DEFAULT_CADENCE);
    expect(t).toHaveLength(4);
    // 4 slots for 4 windows: each window's midpoint, so the evening window is used too.
    expect(t).toEqual(["10:38", "13:00", "16:30", "20:30"]);
    // Any other count: midpoints of equal segments across the 495 window minutes.
    expect(daySlotTimes({ ...DEFAULT_CADENCE, slotsPerDay: 3 })).toEqual(["10:53", "13:53", "17:38"]);
  });

  it("handles a single window and many slots", () => {
    const t = daySlotTimes({ windows: [{ start: "09:00", end: "11:00" }], slotsPerDay: 4 });
    expect(t).toEqual(["09:15", "09:45", "10:15", "10:45"]);
  });
});
