import type { PostRecord } from "../types.js";

let n = 0;
export function post(over: Partial<PostRecord> & { views?: number | null }): PostRecord {
  const { views, ...rest } = over;
  return {
    batchItemId: `p${++n}`,
    platform: "instagram",
    pillar: "gym",
    caption: "Pull day…",
    durationS: 20,
    postedAt: "2026-11-02T16:00:00Z",
    isTrial: false,
    trialSharedAt: null,
    capturedAt: "2026-11-09T00:00:00Z",
    ...rest,
    metrics: {
      views: views === undefined ? 100 : views,
      reach: null,
      likes: null,
      comments: null,
      saves: null,
      shares: null,
      reposts: null,
      avgWatchTime: null,
      skipRate: null,
      ...(rest.metrics ?? {}),
    },
  };
}
