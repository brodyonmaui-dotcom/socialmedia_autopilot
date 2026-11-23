import { describe, expect, it } from "vitest";
import { nextSlotView } from "../next-slot-view.js";

describe("nextSlotView", () => {
  it("formats a slot in the creator zone with 12-hour text", () => {
    const v = nextSlotView({ itemId: "a", field: "b:a", platform: "tiktok", slot: "2098-03-03T09:30:00.000Z" }, "UTC");
    expect(v).toEqual({ itemId: "a", field: "b:a", platform: "tiktok", text: "Mon 9:30 AM", date: "2098-03-03", time: "09:30" });
  });
  it("uses the zone's local date and time", () => {
    const v = nextSlotView({ itemId: "a", field: "b:a", platform: "tiktok", slot: "2098-03-03T02:30:00.000Z" }, "America/New_York");
    expect(v.date).toBe("2098-03-02");
    expect(v.time).toBe("21:30");
    expect(v.text).toBe("Sun 9:30 PM");
  });
  it("null slot gives no text", () => {
    expect(nextSlotView({ itemId: "a", field: "b:a", platform: "x", slot: null }, "UTC").text).toBeNull();
  });
});
