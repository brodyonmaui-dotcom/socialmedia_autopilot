import { describe, expect, it } from "vitest";
import { ERROR_MAX_CHARS, ingestOnce, orderForIngest, type MetricsSource, type PublishedPost } from "../ingest.js";
import { METRICS_FAIL_THRESHOLD, nextHealth, type MetricsHealthState } from "../health.js";
import { EMPTY_METRICS } from "../types.js";

const T0 = Date.parse("2026-11-01T00:00:00Z");
const at = (h: number) => new Date(T0 + h * 3_600_000);
const pub = (over: Partial<PublishedPost> = {}): PublishedPost => ({
  batchItemId: "b1",
  platform: "instagram",
  platformPostId: "17944070922377356",
  postedAt: at(0).toISOString(),
  capturedAges: [],
  ...over,
});
const ok = (platform: PublishedPost["platform"]): MetricsSource => ({ platform, fetch: async () => ({ ...EMPTY_METRICS, views: 1 }) });
const boom = (platform: PublishedPost["platform"], msg: string): MetricsSource => ({
  platform,
  fetch: async () => {
    throw new Error(msg);
  },
});

describe("ingestOnce per-platform reporting", () => {
  it("counts attempted/failed per platform and keeps a sanitised, capped last error", async () => {
    const token = "EAABsbCS1iHgBAKZBZCnotARealTokenButShapedLikeOne1234567890";
    const res = await ingestOnce(
      [pub({ batchItemId: "a" }), pub({ batchItemId: "b" }), pub({ batchItemId: "c", platform: "youtube", platformPostId: "dQw4w9WgXcQ" }), pub({ batchItemId: "d", platform: "tiktok" })],
      { instagram: boom("instagram", `HTTP 400 access_token=${token} ${"x".repeat(400)}`), youtube: ok("youtube") },
      async () => {},
      at(25),
    );
    expect(res.attemptedByPlatform).toEqual({ instagram: 2, youtube: 1 });
    expect(res.failedByPlatform).toEqual({ instagram: 2 });
    expect(res).toMatchObject({ captured: 1, failed: 2, skippedNoSource: 1 });
    const e = res.lastErrorByPlatform.instagram!;
    expect(e.length).toBeLessThanOrEqual(ERROR_MAX_CHARS);
    expect(e).not.toContain(token);
    expect(e).not.toContain(token.slice(4, 24));
    expect(e).toContain("[redacted]");
    expect(res.lastErrorByPlatform.youtube).toBeUndefined();
  });
});

describe("orderForIngest", () => {
  it("returns due posts only, oldest due checkpoint first, capped", () => {
    const now = at(200);
    const posts = [
      pub({ batchItemId: "notdue", postedAt: at(190).toISOString() }), // 10 h old
      pub({ batchItemId: "captured", postedAt: at(150).toISOString(), capturedAges: [24] }), // 50 h, 24 done
      pub({ batchItemId: "young", postedAt: at(170).toISOString() }), // due 24 at h194
      pub({ batchItemId: "old", postedAt: at(0).toISOString() }), // due 168 at h168
      pub({ batchItemId: "mid", postedAt: at(100).toISOString() }), // due 72 at h172
    ];
    expect(orderForIngest(posts, now, 10).map((p) => p.batchItemId)).toEqual(["old", "mid", "young"]);
    expect(orderForIngest(posts, now, 2).map((p) => p.batchItemId)).toEqual(["old", "mid"]);
    expect(orderForIngest(posts, now, 0)).toEqual([]);
  });
});

describe("nextHealth", () => {
  const allFail = { attemptedByPlatform: { instagram: 2 }, failedByPlatform: { instagram: 2 } };
  const partial = { attemptedByPlatform: { instagram: 2 }, failedByPlatform: { instagram: 1 } };
  const nothing = { attemptedByPlatform: {}, failedByPlatform: {} };

  it("trips exactly once at 3 consecutive all-fail runs, then reports recovery", () => {
    let s: MetricsHealthState = {};
    const trips: string[][] = [];
    for (let i = 0; i < 5; i++) {
      const n = nextHealth(s, allFail, at(i));
      trips.push(n.trip);
      expect(n.recovered).toEqual([]);
      s = n.state;
    }
    expect(trips).toEqual([[], [], ["instagram"], [], []]);
    expect(s.instagram).toEqual({ consecutive: 5, lastOkAt: null });
    const r = nextHealth(s, partial, at(9));
    expect(r.recovered).toEqual(["instagram"]);
    expect(r.trip).toEqual([]);
    expect(r.state.instagram).toEqual({ consecutive: 0, lastOkAt: at(9).toISOString() });
    expect(METRICS_FAIL_THRESHOLD).toBe(3);
  });

  it("a partial success resets the counter; a run with nothing attempted changes nothing", () => {
    let s = nextHealth({}, allFail, at(0)).state;
    s = nextHealth(s, allFail, at(1)).state;
    s = nextHealth(s, nothing, at(2)).state;
    expect(s.instagram!.consecutive).toBe(2);
    const reset = nextHealth(s, partial, at(3));
    expect(reset.state.instagram).toEqual({ consecutive: 0, lastOkAt: at(3).toISOString() });
    expect(reset.recovered).toEqual([]); // never tripped, so nothing to recover from
    s = nextHealth(reset.state, allFail, at(4)).state;
    expect(nextHealth(s, allFail, at(5)).trip).toEqual([]);
  });

  it("platforms are independent", () => {
    const res = { attemptedByPlatform: { instagram: 1, youtube: 1 }, failedByPlatform: { youtube: 1 } };
    let s: MetricsHealthState = {};
    let last = nextHealth(s, res, at(0));
    for (let i = 1; i < 3; i++) last = nextHealth((s = last.state), res, at(i));
    expect(last.trip).toEqual(["youtube"]);
    expect(last.state.instagram!.consecutive).toBe(0);
  });
});
