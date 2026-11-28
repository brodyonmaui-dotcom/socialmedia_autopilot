import { describe, expect, it } from "vitest";
import { frameCount, frameTimes, keyTrim, moveHandle, timeToFrac, xToTime } from "../trim.js";

describe("trim maths", () => {
  it("maps x to seconds and clamps", () => {
    expect(xToTime(150, 50, 200, 20)).toBe(10);
    expect(xToTime(-5, 50, 200, 20)).toBe(0);
    expect(xToTime(999, 50, 200, 20)).toBe(20);
    expect(xToTime(10, 0, 0, 20)).toBe(0);
    expect(timeToFrac(5, 20)).toBe(0.25);
  });
  it("keeps the min piece between handles", () => {
    expect(moveHandle("in", 9.9, 2, 5, 10, 0.3)).toEqual({ inS: 4.7, outS: 5 });
    expect(moveHandle("out", 0, 2, 5, 10, 0.3)).toEqual({ inS: 2, outS: 2.3 });
    expect(moveHandle("out", 99, 2, 5, 10)).toEqual({ inS: 2, outS: 10 });
    expect(moveHandle("in", -3, 2, 5, 10)).toEqual({ inS: 0, outS: 5 });
  });
  it("nudges by 0.1 s, 1 s with shift, and ignores other keys", () => {
    expect(keyTrim("in", "ArrowRight", false, 1, 5, 10)).toEqual({ inS: 1.1, outS: 5 });
    expect(keyTrim("out", "ArrowLeft", true, 1, 5, 10)).toEqual({ inS: 1, outS: 4 });
    expect(keyTrim("out", "End", false, 1, 5, 10)).toEqual({ inS: 1, outS: 10 });
    expect(keyTrim("in", "a", false, 1, 5, 10)).toBeNull();
  });
  it("picks 8-10 frame times inside the clip", () => {
    const t = frameTimes(10, 8);
    expect(t).toHaveLength(8);
    expect(t[0]).toBeGreaterThan(0);
    expect(t.at(-1)!).toBeLessThan(10);
    expect(frameTimes(0, 8)).toEqual([]);
    expect(frameCount(100)).toBe(8);
    expect(frameCount(900)).toBe(10);
  });
});
