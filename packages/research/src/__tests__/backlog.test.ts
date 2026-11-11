import { describe, expect, it } from "vitest";
import { BacklogError, allowedMoves, filmNext, moveIdea, stageCounts } from "../backlog.js";
import type { Idea } from "../types.js";

const base: Idea = {
  id: "i1",
  title: "Pull day one-liner",
  pillar: "gym",
  stage: "idea",
  hook: "",
  script: "",
  sourceCreatorId: null,
  mediaId: null,
  batchItemIds: [],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

describe("moveIdea", () => {
  it("walks idea → scripted → filmed → posted when each requirement is met", () => {
    const s = moveIdea(base, "scripted", { script: "3 shots: warmup, top set, face" });
    const f = moveIdea(s, "filmed", { mediaId: "m1" });
    const p = moveIdea(f, "posted", { batchItemIds: ["b1"] });
    expect([s.stage, f.stage, p.stage]).toEqual(["scripted", "filmed", "posted"]);
    expect(p.mediaId).toBe("m1");
  });

  it("refuses scripted without a script, filmed without a clip, posted without a batch item", () => {
    expect(() => moveIdea(base, "scripted", { script: "   " })).toThrow(BacklogError);
    const s = moveIdea(base, "scripted", { script: "x" });
    expect(() => moveIdea(s, "filmed")).toThrow(/library clip/);
    const f = moveIdea(s, "filmed", { mediaId: "m1" });
    expect(() => moveIdea(f, "posted")).toThrow(/approved batch/);
  });

  it("refuses skipping stages and never moves a posted idea", () => {
    expect(() => moveIdea(base, "filmed", { mediaId: "m1" })).toThrow(/from idea to filmed/);
    const posted: Idea = { ...base, stage: "posted", mediaId: "m", batchItemIds: ["b"] };
    expect(allowedMoves("posted")).toEqual([]);
    expect(() => moveIdea(posted, "dropped")).toThrow(BacklogError);
  });

  it("drops and revives", () => {
    const d = moveIdea(base, "dropped");
    expect(moveIdea(d, "idea").stage).toBe("idea");
    expect(() => moveIdea(d, "scripted", { script: "x" })).toThrow(BacklogError);
  });

  it("doesn't mutate the input and stamps updatedAt", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    const s = moveIdea(base, "scripted", { script: "x" }, now);
    expect(base.stage).toBe("idea");
    expect(s.updatedAt).toBe(now.toISOString());
  });
});

describe("stageCounts / filmNext", () => {
  const ideas: Idea[] = [
    { ...base, id: "a", stage: "scripted", script: "x", createdAt: "2026-11-03T00:00:00Z" },
    { ...base, id: "b", stage: "scripted", script: "x", createdAt: "2026-11-02T00:00:00Z" },
    { ...base, id: "c", stage: "idea", hook: "Welp…", createdAt: "2026-11-01T00:00:00Z" },
    { ...base, id: "d", stage: "idea", createdAt: "2026-10-01T00:00:00Z" },
    { ...base, id: "e", stage: "dropped" },
  ];
  it("counts every stage, zeros included", () => {
    expect(stageCounts(ideas)).toEqual({ idea: 2, scripted: 2, filmed: 0, posted: 0, dropped: 1 });
  });
  it("suggests scripted (oldest first), then hooked ideas; skips hookless and dropped", () => {
    expect(filmNext(ideas).map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(filmNext(ideas, 1).map((i) => i.id)).toEqual(["b"]);
  });
});
