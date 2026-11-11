import { describe, expect, it } from "vitest";
import { BacklogError } from "../backlog.js";
import { addCreator, addHook, moveIdeaById, normalizeHandle, validateCreator, validateIdea, ValidationError, type QueryPool } from "../store.js";

function fakePool(responses: Array<any[]>): QueryPool & { calls: Array<{ sql: string; params?: unknown[] }> } {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: responses.shift() ?? [] };
    },
  };
}

const ideaRow = {
  id: "i1",
  title: "t",
  pillar: "gym",
  stage: "scripted",
  hook: "",
  script: "x",
  source_creator_id: null,
  media_id: null,
  batch_item_ids: [],
  created_at: new Date("2026-11-01T00:00:00Z"),
  updated_at: new Date("2026-11-01T00:00:00Z"),
};

describe("validation", () => {
  it("normalizes handles from @, URLs and case", () => {
    expect(normalizeHandle("@Example_Lifter")).toBe("example_lifter");
    expect(normalizeHandle("https://www.instagram.com/example.trader/")).toBe("example.trader");
    expect(() => normalizeHandle("bad handle!")).toThrow(ValidationError);
  });

  it("rejects unknown platforms/pillars and place-naming notes", () => {
    expect(() => validateCreator({ platform: "myspace", handle: "a" })).toThrow(/platform/);
    expect(() => validateCreator({ platform: "instagram", handle: "a", pillar: "crypto" })).toThrow(/pillar/);
    expect(() => validateCreator({ platform: "instagram", handle: "a", notes: "trains at Riverside Fitness" })).toThrow(/place/);
    expect(() => validateIdea({ title: "  " })).toThrow(/title/);
    expect(() => validateIdea({ title: "x", hook: "heading to the park" })).toThrow(/hook/);
  });
});

describe("queries (fake pool)", () => {
  it("addCreator upserts the normalized row", async () => {
    const pool = fakePool([[{ id: "c1", platform: "instagram", handle: "ex", pillar: null, notes: "", followers: null, active: true, last_checked_at: null, created_at: new Date(0) }]]);
    const c = await addCreator(pool, { platform: "instagram", handle: "@EX" });
    expect(pool.calls[0]!.params).toEqual(["instagram", "ex", null, "", null]);
    expect(pool.calls[0]!.sql).toMatch(/on conflict \(platform, handle\)/);
    expect(c.createdAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("addHook refuses blocklisted terms before touching the DB", async () => {
    const pool = fakePool([]);
    await expect(addHook(pool, { text: "Leg day in springfield" }, ["springfield"])).rejects.toThrow(ValidationError);
    expect(pool.calls).toHaveLength(0);
  });

  it("moveIdeaById validates with moveIdea and guards on the old stage (double tap = no second move)", async () => {
    const pool = fakePool([[ideaRow], [{ ...ideaRow, stage: "filmed", media_id: "m1" }]]);
    const moved = await moveIdeaById(pool, "i1", "filmed", { mediaId: "m1" });
    expect(moved.stage).toBe("filmed");
    expect(pool.calls[1]!.sql).toMatch(/where id = \$1 and stage = \$7/);
    expect(pool.calls[1]!.params?.[6]).toBe("scripted");

    const raced = fakePool([[ideaRow], []]);
    await expect(moveIdeaById(raced, "i1", "filmed", { mediaId: "m1" })).rejects.toThrow(/changed meanwhile/);

    const illegal = fakePool([[ideaRow]]);
    await expect(moveIdeaById(illegal, "i1", "posted", { batchItemIds: ["b"] })).rejects.toThrow(BacklogError);
    expect(illegal.calls).toHaveLength(1);
  });
});
