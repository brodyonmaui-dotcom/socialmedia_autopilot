import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE, localDate } from "@autopilot/core";
import { fillTimesChanges, planFillTimes } from "../fill-times.js";
import { makeBatch, makeItem, NOW } from "./fixtures.js";

const ctx = { cadence: DEFAULT_CADENCE, timeZone: "UTC", existing: [], now: NOW };
const WEEK = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];

describe("planFillTimes", () => {
  it("times two untimed items on one clip in the week, in the future, youtube staggered after instagram", () => {
    const ig = makeItem({ mediaId: "m1", platform: "instagram", scheduledFor: null });
    const yt = makeItem({ mediaId: "m1", platform: "youtube", title: "Calm title", scheduledFor: null });
    const timed = makeItem({ mediaId: "m2", scheduledFor: "2026-11-16T10:00:00.000Z" });
    const batch = makeBatch([ig, yt, timed]);
    const { patches, unplaced } = planFillTimes(batch, ctx);
    expect(unplaced).toEqual([]);
    expect(patches.map((p) => p.itemId).sort()).toEqual([ig.id, yt.id].sort());
    const at = (id: string) => patches.find((p) => p.itemId === id)!.scheduledFor;
    for (const id of [ig.id, yt.id]) {
      expect(new Date(at(id)).getTime()).toBeGreaterThan(NOW.getTime());
      expect(WEEK).toContain(localDate(new Date(at(id)), "UTC"));
    }
    // DEFAULT_CADENCE: youtube = same day, one slot after instagram
    expect(localDate(new Date(at(yt.id)), "UTC")).toBe(localDate(new Date(at(ig.id)), "UTC"));
    expect(new Date(at(yt.id)).getTime()).toBeGreaterThan(new Date(at(ig.id)).getTime());
    expect(patches.some((p) => p.itemId === timed.id)).toBe(false);

    const changes = fillTimesChanges(batch, patches);
    expect(changes).toContainEqual({ itemId: ig.id, from: "draft", to: "draft", eventKind: "edit", patch: { scheduled_for: at(ig.id) } });
    expect(changes).toHaveLength(2);
  });

  it("leaves timed, non-draft and rejected items alone", () => {
    const items = [makeItem(), makeItem({ status: "approved" }), makeItem({ status: "rejected", scheduledFor: null })];
    expect(planFillTimes(makeBatch(items), ctx)).toEqual({ patches: [], unplaced: [] });
  });

  it("cap exhaustion yields unplaced with a reason", () => {
    const cadence = { ...DEFAULT_CADENCE, dailyCaps: { ...DEFAULT_CADENCE.dailyCaps, instagram: 0 } };
    const a = makeItem({ scheduledFor: null });
    const { patches, unplaced } = planFillTimes(makeBatch([a]), { ...ctx, cadence });
    expect(patches).toEqual([]);
    expect(unplaced).toHaveLength(1);
    expect(unplaced[0]).toMatchObject({ itemId: a.id });
    expect(unplaced[0]!.reason).toMatch(/^cap: /);
  });

  it("the same clip twice on one platform: one gets a time, the other is unplaced", () => {
    const a = makeItem({ mediaId: "m9", scheduledFor: null });
    const b = makeItem({ mediaId: "m9", scheduledFor: null });
    const { patches, unplaced } = planFillTimes(makeBatch([a, b]), ctx);
    expect(patches.map((p) => p.itemId)).toEqual([a.id]);
    expect(unplaced).toEqual([{ itemId: b.id, reason: expect.stringContaining("duplicate") }]);
  });
});
