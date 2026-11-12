import { describe, expect, it } from "vitest";
import { addCalendarDays, assertTimeZone, diffCalendarDays, hasOffsetChange, localDate, localHHMM, localToUtc, offsetMinutes, weekdayIndex, zonedTimeToUtc } from "../time.js";

// Fixture zones only: they exercise DST rules and say nothing about the creator (TZ_CREATOR stays in .env).
const NY = "America/New_York";
const BERLIN = "Europe/Berlin";
const SYDNEY = "Australia/Sydney";

describe("zonedTimeToUtc", () => {
  it("round-trips an ordinary wall-clock time", () => {
    const d = zonedTimeToUtc(2026, 11, 12, 9, 30, NY);
    expect(localHHMM(d, NY)).toBe("09:30");
    expect(localDate(d, NY)).toBe("2026-11-12");
    expect(d.toISOString()).toBe("2026-11-12T14:30:00.000Z");
  });

  it("keeps the wall-clock time on both sides of a fall-back change", () => {
    // US fall-back: 2026-11-01 02:00 EDT -> 01:00 EST
    const before = zonedTimeToUtc(2026, 10, 31, 20, 30, NY);
    const after = zonedTimeToUtc(2026, 11, 1, 20, 30, NY);
    expect(localHHMM(before, NY)).toBe("20:30");
    expect(localHHMM(after, NY)).toBe("20:30");
    expect(after.getTime() - before.getTime()).toBe(25 * 3_600_000); // a 25-hour day, as it should be
  });

  it("keeps the wall-clock time across a spring-forward change", () => {
    // US spring-forward: 2027-03-14 02:00 -> 03:00
    const before = zonedTimeToUtc(2027, 3, 13, 9, 30, NY);
    const after = zonedTimeToUtc(2027, 3, 14, 9, 30, NY);
    expect(localHHMM(after, NY)).toBe("09:30");
    expect(after.getTime() - before.getTime()).toBe(23 * 3_600_000);
  });

  it("maps a non-existent spring-forward time to the valid instant just after the gap", () => {
    const d = zonedTimeToUtc(2027, 3, 14, 2, 30, NY); // 02:30 never happens that day
    expect(d.toISOString()).toBe("2027-03-14T07:30:00.000Z"); // = 03:30 EDT
    expect(localDate(d, NY)).toBe("2027-03-14");
  });

  it("resolves an ambiguous fall-back time deterministically to the first occurrence", () => {
    const d = zonedTimeToUtc(2026, 11, 1, 1, 30, NY); // happens twice (EDT then EST)
    expect(localHHMM(d, NY)).toBe("01:30");
    expect(offsetMinutes(d, NY)).toBe(-240); // EDT: the first one
  });

  it("works in southern-hemisphere and positive-offset zones", () => {
    const syd = zonedTimeToUtc(2026, 10, 4, 12, 0, SYDNEY); // AEDT starts 2026-10-04
    expect(localHHMM(syd, SYDNEY)).toBe("12:00");
    const ber = zonedTimeToUtc(2026, 10, 25, 20, 0, BERLIN); // CET returns 2026-10-25
    expect(localHHMM(ber, BERLIN)).toBe("20:00");
    expect(ber.toISOString()).toBe("2026-10-25T19:00:00.000Z");
  });
});

describe("calendar helpers", () => {
  it("adds and diffs calendar days without touching instants", () => {
    expect(addCalendarDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(diffCalendarDays("2026-11-01", "2026-11-08")).toBe(7);
    expect(diffCalendarDays("2026-11-08", "2026-11-01")).toBe(-7);
  });

  it("weekdayIndex is Monday-based", () => {
    expect(weekdayIndex("2026-11-09")).toBe(0); // Monday
    expect(weekdayIndex("2026-11-15")).toBe(6); // Sunday
  });

  it("localToUtc accepts YYYY-MM-DD + HH:MM", () => {
    expect(localToUtc("2026-11-12", "20:00", NY).toISOString()).toBe("2026-11-13T01:00:00.000Z");
  });

  it("hasOffsetChange detects a DST week and nothing in a flat week", () => {
    expect(hasOffsetChange(localToUtc("2026-10-26", "00:00", NY), localToUtc("2026-11-02", "00:00", NY), NY)).toBe(true);
    expect(hasOffsetChange(localToUtc("2026-11-09", "00:00", NY), localToUtc("2026-11-16", "00:00", NY), NY)).toBe(false);
    expect(hasOffsetChange(new Date("2026-01-01T00:00:00Z"), new Date("2026-12-31T00:00:00Z"), "UTC")).toBe(false);
  });

  it("assertTimeZone rejects missing or invalid zones", () => {
    expect(() => assertTimeZone(undefined)).toThrow(/TZ_CREATOR/);
    expect(() => assertTimeZone("Mars/Olympus")).toThrow(/IANA/);
    expect(assertTimeZone("UTC")).toBe("UTC");
  });
});
