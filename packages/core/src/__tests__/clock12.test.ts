import { describe, expect, it } from "vitest";
import { clock12FromHHMM, localClock12 } from "../time.js";

describe("12-hour display time", () => {
  it.each([
    ["00:00", "12:00 AM"],
    ["00:05", "12:05 AM"],
    ["08:00", "8:00 AM"],
    ["11:59", "11:59 AM"],
    ["12:00", "12:00 PM"],
    ["12:30", "12:30 PM"],
    ["17:38", "5:38 PM"],
    ["23:59", "11:59 PM"],
  ])("%s -> %s", (a, b) => expect(clock12FromHHMM(a)).toBe(b));
  it("passes through what it can't parse", () => {
    expect(clock12FromHHMM("")).toBe("");
    expect(clock12FromHHMM("25:00")).toBe("25:00");
    expect(clock12FromHHMM("soon")).toBe("soon");
  });
  it("formats an instant in a zone", () => {
    expect(localClock12(new Date("2026-11-20T19:30:00Z"), "UTC")).toBe("7:30 PM");
  });
});
