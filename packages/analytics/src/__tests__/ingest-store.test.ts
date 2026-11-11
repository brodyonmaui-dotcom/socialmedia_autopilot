import { describe, expect, it } from "vitest";
import { createUnverifiedSource, dueAge, ingestOnce, instagramInsightPaths, type MetricsSource, type PublishedPost } from "../ingest.js";
import { loadPostRecords, normalizeMetrics, writeSnapshot, type QueryPool } from "../store.js";
import { EMPTY_METRICS } from "../types.js";

const pub = (over: Partial<PublishedPost> = {}): PublishedPost => ({
  batchItemId: "b1",
  platform: "instagram",
  platformPostId: "17944070922377356",
  postedAt: "2026-11-01T00:00:00Z",
  capturedAges: [],
  ...over,
});
const at = (h: number) => new Date(Date.parse("2026-11-01T00:00:00Z") + h * 3_600_000);

describe("dueAge", () => {
  it("picks the latest passed checkpoint not yet captured; never back-fills an old label", () => {
    expect(dueAge(pub(), at(23))).toBeNull();
    expect(dueAge(pub(), at(24))).toBe(24);
    expect(dueAge(pub({ capturedAges: [24] }), at(30))).toBeNull();
    expect(dueAge(pub({ capturedAges: [24] }), at(72))).toBe(72);
    expect(dueAge(pub(), at(200))).toBe(168); // missed 24/72: only 168 is taken
    expect(dueAge(pub({ capturedAges: [672] }), at(5000))).toBeNull();
  });
});

describe("ingestOnce", () => {
  it("captures due posts, skips platforms without a source, counts failures without writing", async () => {
    const ok: MetricsSource = { platform: "instagram", fetch: async () => ({ ...EMPTY_METRICS, views: 10 }) };
    const writes: unknown[] = [];
    const res = await ingestOnce(
      [pub({ batchItemId: "a" }), pub({ batchItemId: "b", platform: "tiktok" }), pub({ batchItemId: "c", platform: "youtube" }), pub({ batchItemId: "d", postedAt: "2026-11-05T00:00:00Z" })],
      { instagram: ok, youtube: createUnverifiedSource("youtube") },
      async (w) => void writes.push(w),
      at(25),
    );
    expect(res).toMatchObject({ captured: 1, skippedNoSource: 1, failed: 1 });
    expect(writes).toEqual([{ batchItemId: "a", ageHours: 24, metrics: { ...EMPTY_METRICS, views: 10 } }]);
  });

  it("IG requests one metric per call, verified names only", () => {
    const paths = instagramInsightPaths("17944070922377356");
    expect(paths).toHaveLength(8);
    expect(paths[0]).toBe("/17944070922377356/insights?metric=views");
    expect(paths.join()).not.toMatch(/follows|profile_visits|saves\b/);
    expect(() => instagramInsightPaths("1/../x")).toThrow();
  });

  it("platform parsers stay stubs until research.md records the response shape", async () => {
    await expect(createUnverifiedSource("instagram").fetch("1")).rejects.toThrow(/not verified/);
  });
});

describe("store", () => {
  it("normalizes metrics: missing stays null, numeric strings parse, junk → null", () => {
    expect(normalizeMetrics({ views: "120", likes: 3, saves: "x" })).toEqual({ ...EMPTY_METRICS, views: 120, likes: 3 });
    expect(normalizeMetrics(null)).toEqual(EMPTY_METRICS);
  });

  it("maps rows: trial only if it didn't fall back, sharedAt, no snapshot = empty metrics", async () => {
    const pool: QueryPool = {
      async query() {
        return {
          rows: [
            { id: "1", platform: "instagram", caption: "a", scheduled_for: new Date("2026-11-02T00:00:00Z"), trial: { graduation_strategy: "MANUAL" }, pillar: "gym", duration_s: "12.5", metrics: { views: 5 }, captured_at: new Date("2026-11-03T00:00:00Z") },
            { id: "2", platform: "instagram", caption: "b", scheduled_for: "2026-11-02T00:00:00.000Z", trial: { fellBack: true }, pillar: null, duration_s: null, metrics: null, captured_at: null },
            { id: "3", platform: "instagram", caption: "c", scheduled_for: "2026-11-02T00:00:00.000Z", trial: { sharedAt: "2026-11-04T00:00:00Z" }, pillar: null, duration_s: null, metrics: null, captured_at: null },
          ],
        };
      },
    };
    const [a, b, c] = await loadPostRecords(pool, new Date(0));
    expect(a).toMatchObject({ isTrial: true, durationS: 12.5, postedAt: "2026-11-02T00:00:00.000Z", metrics: { views: 5 } });
    expect(b).toMatchObject({ isTrial: false, metrics: EMPTY_METRICS, capturedAt: null });
    expect(c).toMatchObject({ isTrial: true, trialSharedAt: "2026-11-04T00:00:00Z" });
  });

  it("writeSnapshot is idempotent per checkpoint", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    await writeSnapshot({ query: async (sql, params) => (calls.push({ sql, params }), { rows: [] }) }, { batchItemId: "b", ageHours: 24, metrics: EMPTY_METRICS });
    expect(calls[0]!.sql).toMatch(/on conflict \(batch_item_id, age_hours\) do nothing/);
    expect(calls[0]!.params?.[2]).toBe(JSON.stringify(EMPTY_METRICS));
  });
});
