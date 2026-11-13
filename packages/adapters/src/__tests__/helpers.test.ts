import { describe, expect, it } from "vitest";
import { assertNoLocationFields } from "../http.js";

// F7 C3: the location boundary (CLAUDE.md non-negotiable #5) on every outgoing body.
const KEYS = [
  "location_id", "location", "recordingDetails", "locationDescription", "locationTags", "place_id", "place", "geo", "geolocation",
  "coordinates", "latitude", "longitude", "lat", "lng", "lon", "gps", "poi_id", "venue",
];

describe("assertNoLocationFields", () => {
  it.each(KEYS)("refuses top-level %s", (k) => {
    expect(() => assertNoLocationFields("test", { caption: "hi", [k]: "x" })).toThrow(/refusing to send location field/);
  });

  it.each(KEYS)("refuses %s case-insensitively", (k) => {
    expect(() => assertNoLocationFields("test", { [k.toUpperCase()]: 1 })).toThrow(/location field/);
  });

  it.each(KEYS)("refuses %s nested in objects and arrays", (k) => {
    expect(() => assertNoLocationFields("test", { snippet: { tags: ["a"] }, platforms: [{ id: "tt", opts: { [k]: { a: 1 } } }] })).toThrow(new RegExp(`platforms\\.0\\.opts\\.${k}`));
  });

  it("refuses with a NonRetryableError (a retry can't fix it)", () => {
    expect(() => assertNoLocationFields("test", { geo: null })).toThrow(expect.objectContaining({ name: "NonRetryableError" }));
  });

  it("passes ordinary bodies and look-alike keys (no substring false positives)", () => {
    const body = {
      allocation: 1, translation: "x", relocate: true, displacement: 2, latency: 3, longform: false, lonely: "", gpsless: 0, venues_count: 1,
      media_type: "REELS", caption: "london session at the open", snippet: { title: "t", description: "lat pulldown" }, status: { privacyStatus: "private" },
      platforms: [{ platform: "tiktok", accountId: "a" }],
    };
    expect(() => assertNoLocationFields("test", body)).not.toThrow();
  });
});
