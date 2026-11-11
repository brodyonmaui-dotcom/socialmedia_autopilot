import { describe, expect, it } from "vitest";
import { isWithinAnyWindow, isWithinAnyWindowAt } from "../cadence.js";
import type { PostingWindow } from "../types.js";

const windows: PostingWindow[] = [
  { start: "09:30", end: "11:45" },
  { start: "12:00", end: "14:00" },
  { start: "15:00", end: "18:00" },
  { start: "20:00", end: "21:00" },
];

describe("isWithinAnyWindow", () => {
  it("is true at the exact boundaries", () => {
    expect(isWithinAnyWindow("09:30", windows)).toBe(true);
    expect(isWithinAnyWindow("11:45", windows)).toBe(true);
  });

  it("is true inside a window", () => {
    expect(isWithinAnyWindow("13:00", windows)).toBe(true);
  });

  it("is false in the gap between windows", () => {
    expect(isWithinAnyWindow("11:46", windows)).toBe(false);
    expect(isWithinAnyWindow("19:00", windows)).toBe(false);
  });
});

describe("isWithinAnyWindowAt", () => {
  it("resolves the date in the given time zone before checking", () => {
    // 2026-11-11T18:00:00Z is 13:00 in America/New_York (within the noon window)
    const date = new Date("2026-11-11T18:00:00Z");
    expect(isWithinAnyWindowAt(date, windows, "America/New_York")).toBe(true);
    // but 18:00 UTC itself (if misread as local time) would be the far edge of a different window
    expect(isWithinAnyWindowAt(date, windows, "UTC")).toBe(true); // 18:00 UTC = end of the 15:00-18:00 window
    expect(isWithinAnyWindow("19:00", windows)).toBe(false); // the actual gap between windows
  });
});
