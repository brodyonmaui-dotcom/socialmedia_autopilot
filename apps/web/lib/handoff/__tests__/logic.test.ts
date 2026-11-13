import { describe, expect, it } from "vitest";
import { bucketFor, handoffBlocks, nextFreeDay, NO_CLEAN_FILE, skipTarget } from "../logic.js";

// Fixture zone (as elsewhere in tests); not the creator's zone. UK clocks go back 2026-10-25, forward 2026-03-29.
const TZ = "Europe/London";

describe("bucketFor", () => {
  it("today vs missed vs future on the fall-back day (BST → GMT)", () => {
    const today = "2026-10-25";
    expect(bucketFor("2026-10-24T23:30:00.000Z", today, TZ)).toBe("today"); // 00:30 BST on the 25th
    expect(bucketFor("2026-10-24T22:59:00.000Z", today, TZ)).toBe("missed"); // 23:59 BST on the 24th
    expect(bucketFor("2026-10-25T23:30:00.000Z", today, TZ)).toBe("today"); // 23:30 GMT on the 25th
    expect(bucketFor("2026-10-26T00:00:00.000Z", today, TZ)).toBe("future");
  });

  it("works across the spring-forward day too", () => {
    const today = "2026-03-29";
    expect(bucketFor("2026-03-29T00:30:00.000Z", today, TZ)).toBe("today"); // 00:30 GMT
    expect(bucketFor("2026-03-29T22:59:00.000Z", today, TZ)).toBe("today"); // 23:59 BST
    expect(bucketFor("2026-03-29T23:00:00.000Z", today, TZ)).toBe("future"); // 00:00 BST on the 30th
    expect(bucketFor("2026-03-28T23:59:00.000Z", today, TZ)).toBe("missed");
  });
});

describe("nextFreeDay", () => {
  it("is strictly after the start day and skips taken days", () => {
    expect(nextFreeDay("2026-11-13", new Set())).toBe("2026-11-14");
    expect(nextFreeDay("2026-11-13", new Set(["2026-11-14", "2026-11-15"]))).toBe("2026-11-16");
    expect(nextFreeDay("2026-12-31", new Set(["2027-01-01"]))).toBe("2027-01-02");
  });

  it("returns null when the next 14 days are all taken", () => {
    const taken = new Set(Array.from({ length: 14 }, (_, i) => `2026-11-${String(14 + i).padStart(2, "0")}`));
    expect(nextFreeDay("2026-11-13", taken)).toBeNull();
    taken.delete("2026-11-27");
    expect(nextFreeDay("2026-11-13", taken)).toBe("2026-11-27");
    expect(nextFreeDay("2026-11-13", new Set(["2026-11-14"]), 1)).toBeNull();
  });
});

describe("skipTarget", () => {
  it("keeps the local HH:MM across the fall-back change", () => {
    // 18:30 BST on the 24th → 18:30 GMT on the 25th.
    expect(skipTarget({ scheduledFor: "2026-10-24T17:30:00.000Z" }, new Set(), TZ)).toEqual({
      scheduledFor: "2026-10-25T18:30:00.000Z",
      localDay: "2026-10-25",
    });
    expect(skipTarget({ scheduledFor: "2026-10-24T17:30:00.000Z" }, new Set(["2026-10-25"]), TZ)).toEqual({
      scheduledFor: "2026-10-26T18:30:00.000Z",
      localDay: "2026-10-26",
    });
  });

  it("keeps the local HH:MM across the spring-forward change", () => {
    // 18:30 GMT on the 28th → 18:30 BST on the 29th.
    expect(skipTarget({ scheduledFor: "2026-03-28T18:30:00.000Z" }, new Set(), TZ)).toEqual({
      scheduledFor: "2026-03-29T17:30:00.000Z",
      localDay: "2026-03-29",
    });
  });

  it("rolls a missed item forward from today, not from its old day", () => {
    expect(skipTarget({ scheduledFor: "2026-11-10T18:00:00.000Z" }, new Set(["2026-11-14"]), TZ, "2026-11-13")).toEqual({
      scheduledFor: "2026-11-15T18:00:00.000Z",
      localDay: "2026-11-15",
    });
  });

  it("is null when no free day is within 14 days", () => {
    const taken = new Set(Array.from({ length: 14 }, (_, i) => `2026-11-${String(14 + i).padStart(2, "0")}`));
    expect(skipTarget({ scheduledFor: "2026-11-13T18:00:00.000Z" }, taken, TZ)).toBeNull();
  });
});

describe("handoffBlocks", () => {
  it("blocks a named place, coordinates and a blocklisted term, showing the rule", () => {
    expect(handoffBlocks("Leg day at the Riverside gym", true, []).join(" ")).toMatch(/privacy\.place/);
    expect(handoffBlocks("spot 51.50123, -0.12345", true, []).join(" ")).toMatch(/privacy\.coords/);
    expect(handoffBlocks("back at zebrafield again", true, ["Zebrafield"]).join(" ")).toMatch(/privacy\.blocklist/);
  });

  it("blocks when there's no clean file", () => {
    expect(handoffBlocks("Pull day, nothing fancy", false, [])).toEqual([NO_CLEAN_FILE]);
    expect(NO_CLEAN_FILE).toMatch(/^no clean file yet/);
  });

  it("doesn't block a market-session phrase or non-privacy lint issues", () => {
    expect(handoffBlocks("NY session was choppy, sat on my hands", true, [])).toEqual([]);
    // Hype is a tone error, not privacy: shown elsewhere, never blocks the share.
    expect(handoffBlocks("this setup is insane", true, [])).toEqual([]);
  });
});
