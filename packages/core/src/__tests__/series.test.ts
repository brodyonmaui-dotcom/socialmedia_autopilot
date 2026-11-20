import { describe, expect, it } from "vitest";
import { normalizeCaption, seriesOf } from "../series.js";

describe("seriesOf", () => {
  it("reads the day number and a key without it", () => {
    expect(seriesOf("Day 13 of showing up every morning #gym")).toEqual({ key: "showing up every morning", day: 13 });
    expect(seriesOf("day #7: showing up every morning")).toEqual({ key: "showing up every morning", day: 7 });
  });

  it("the same series on different days shares one key", () => {
    const a = seriesOf("Day 10 of showing up every morning");
    const b = seriesOf("Day 11 of showing up every morning");
    expect(a?.key).toBe(b?.key);
    expect([a?.day, b?.day]).toEqual([10, 11]);
  });

  it("no 'Day N' → null (a 'pull day' isn't a series)", () => {
    expect(seriesOf("My lats are not a fan of this pull day…")).toBeNull();
    expect(seriesOf("")).toBeNull();
  });

  it("a caption that is only 'Day N' gets a fallback key", () => {
    expect(seriesOf("Day 3")).toEqual({ key: "day-series", day: 3 });
  });
});

describe("normalizeCaption", () => {
  it("drops hashtags and punctuation, keeps decimals", () => {
    expect(normalizeCaption("Up 2.5% today!! #stocks Not financial advice.")).toBe("up 2.5 today");
  });
});
