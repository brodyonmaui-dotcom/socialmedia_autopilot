import { describe, expect, it } from "vitest";
import { buildQueue, diff, matchOne, seriesOf, similarity, summarize, type Snapshot, type SourcePost, type TargetPost } from "../lib/backfill.js";
import { draftFromQueue, guessPillar, hookLine, ytTitle } from "../lib/backfill-draft.js";

const ig = (id: string, caption: string, day: number, extra: Partial<SourcePost> = {}): SourcePost => ({
  id,
  caption,
  timestamp: new Date(Date.UTC(2026, 10, day, 18)).toISOString(),
  permalink: `https://www.instagram.com/reel/${id}/`,
  ...extra,
});
const tp = (id: string, text: string, day: number, via: TargetPost["via"] = "platform"): TargetPost => ({ id, text, timestamp: new Date(Date.UTC(2026, 10, day, 20)).toISOString(), via });

const series = (n: number) => `Day ${n} of showing you what it takes to pass a 10k prop firm account. Not financial advice.\n\n#daytrading #nasdaq`;

describe("matching", () => {
  it("finds the series day number", () => {
    expect(seriesOf(series(13))).toEqual({ key: expect.stringContaining("showing"), day: 13 });
    expect(seriesOf("My lats are not a fan of this pull day…")).toBeNull();
  });

  it("scores a YouTube title that is a short subset of the IG caption as a match", () => {
    expect(similarity("My lats are not a fan of this pull day… #gym #gymbro", "My lats are not a fan of this pull day…\nJust stacking days.")).toBeGreaterThanOrEqual(0.6);
  });

  it("never matches a different episode of the same series", () => {
    const r = matchOne(ig("a", series(9), 9), [tp("y8", series(8), 10)]);
    expect(r.verdict).toBe("missing");
  });

  it("matches the same episode even with different wording around it", () => {
    const r = matchOne(ig("a", series(9), 9), [tp("y9", "Day 9: 10k prop firm journey\n#daytrading", 12)]);
    expect(r.verdict).toBe("posted");
  });

  it("keeps two series that share a day number apart", () => {
    const r = matchOne(ig("a", series(3), 9), [tp("m3", "Day 3 of training my mind for trading", 10)]);
    expect(r.verdict).not.toBe("posted");
  });

  it("ignores platform posts published well before the IG reel", () => {
    const r = matchOne(ig("a", "Leg day and I are not on speaking terms…", 10), [tp("old", "Leg day and I are not on speaking terms…", 2)]);
    expect(r.verdict).toBe("missing");
  });

  it("counts our own outbox rows as already scheduled, whatever their time", () => {
    const r = matchOne(ig("a", "Leg day and I are not on speaking terms…", 10), [tp("ob", "Leg day and I are not on speaking terms…", 2, "outbox")]);
    expect(r.verdict).toBe("posted");
  });

  it("marks reels older than the listing's coverage as check, never missing", () => {
    const r = matchOne(ig("a", "Something unique about rows…", 3), [], new Date(Date.UTC(2026, 10, 5)).toISOString());
    expect(r.verdict).toBe("check");
  });

  it("puts weak matches in check", () => {
    const r = matchOne(ig("a", "Pull day felt heavy today, lats are cooked", 10), [tp("y", "Pull day felt light", 11)]);
    expect(r.verdict).toBe("check");
  });
});

describe("queue", () => {
  const snap: Snapshot = {
    takenAt: "2026-11-15T00:00:00Z",
    instagram: [
      // Day 10 was posted on IG before day 9 (out of order); every platform must still get 9 before 10.
      ig("d10", series(10), 3),
      ig("d9", series(9), 4),
      ig("legs", "Leg day and I are not on speaking terms…", 5, { licensedAudio: true }),
      ig("pull", "My lats are not a fan of this pull day…", 6, { licensedAudio: true }),
      ig("d8", series(8), 1),
    ],
    youtube: [tp("y8", series(8), 2)],
    tiktok: [],
  };

  it("keeps series episodes in day order and respects the per-day pace", () => {
    const res = diff(snap);
    const q = buildQueue(res, { perDay: { youtube: 2, tiktok: 2 } });
    const yt = q.filter((x) => x.target === "youtube");
    expect(yt.map((x) => x.ig.id)).toEqual(["d9", "d10", "legs", "pull"]);
    expect(yt.map((x) => x.day)).toEqual([0, 0, 1, 1]);
    const tt = q.filter((x) => x.target === "tiktok").map((x) => x.ig.id);
    expect(tt.indexOf("d8")).toBeLessThan(tt.indexOf("d9"));
    expect(tt.indexOf("d9")).toBeLessThan(tt.indexOf("d10"));
  });

  it("sends licensed-audio reels to TikTok as drafts, capped per day, and never back-fills earlier days", () => {
    const q = buildQueue(diff(snap), { perDay: { youtube: 5, tiktok: 5 } }, { maxTikTokDraftsPerDay: 1 });
    const tt = q.filter((x) => x.target === "tiktok");
    const drafts = tt.filter((x) => x.tiktokDraft);
    expect(drafts.map((x) => x.ig.id).sort()).toEqual(["legs", "pull"]);
    expect(new Set(drafts.map((x) => x.day)).size).toBe(2);
    for (let i = 1; i < tt.length; i++) expect(tt[i]!.day).toBeGreaterThanOrEqual(tt[i - 1]!.day);
  });

  it("summarizes counts, days to clear and series gaps", () => {
    const res = diff(snap);
    const s = summarize(res, buildQueue(res, { perDay: { youtube: 2, tiktok: 2 } }));
    expect(s.byTarget.youtube).toEqual({ posted: 1, missing: 4, check: 0 });
    expect(s.daysToClear.youtube).toBe(2);
    expect(s.seriesGaps).toContainEqual(expect.objectContaining({ target: "youtube", igLatest: 10, targetLatest: 8 }));
  });
});

describe("draft", () => {
  it("adapts captions per platform and leaves mediaId for matching", () => {
    const res = diff({ takenAt: "x", instagram: [ig("d9", series(9), 4)], youtube: [], tiktok: [] });
    const q = buildQueue(res, { perDay: { youtube: 2, tiktok: 2 } });
    const slots = (_t: string, days: number) => Array.from({ length: days * 2 }, (_, i) => new Date(Date.UTC(2026, 10, 16 + Math.floor(i / 2), 15 + (i % 2) * 4)));
    const d = draftFromQueue(q, { weekStart: "2026-11-16", perDay: { youtube: 2, tiktok: 2 }, slotsFor: slots });
    expect(d.items).toHaveLength(1);
    const it0 = d.items[0]!;
    expect(it0.mediaId).toBe("");
    expect(it0.pillar).toBe("trading");
    expect(it0.posts.youtube!.title!.length).toBeLessThanOrEqual(60);
    expect(it0.posts.youtube!.caption).toContain("Not financial advice.");
    expect(it0.posts.youtube!.caption.match(/#/g)).toHaveLength(3);
    expect(it0.posts.tiktok!.caption.match(/#/g)!.length).toBeLessThanOrEqual(5);
    expect(it0.posts.tiktok!.scheduledFor).toBe("2026-11-16T15:00:00.000Z");
  });

  it("helpers", () => {
    expect(hookLine("#gym\nJust stacking days is all 🙂‍↕️… #gymbro")).toBe("Just stacking days is all 🙂‍↕️…");
    expect(ytTitle("x".repeat(80)).length).toBeLessThanOrEqual(60);
    expect(guessPillar("November 2nd P/L +$806")).toBe("trading");
    expect(guessPillar("Pull day…")).toBe("gym");
  });
});
