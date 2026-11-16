import { describe, expect, it } from "vitest";
import { matchAccountPost, matchAccountPosts, normaliseText, type MatchCandidate } from "../account-match.js";

const item = (over: Partial<MatchCandidate>): MatchCandidate => ({
  batchItemId: "bi-1",
  platform: "instagram",
  platformPostId: null,
  caption: "Pull day, slow negatives… #gym",
  title: null,
  scheduledFor: "2026-11-10T17:00:00Z",
  ...over,
});
const post = { platform: "instagram" as const, platformPostId: "18000000000000001", caption: "Pull day,  slow negatives… #GYM", title: null, publishedAt: "2026-11-10T17:01:00Z" };

describe("account post matching", () => {
  it("normalises whitespace, case, NFC and @handles", () => {
    expect(normaliseText("  Café  @someone  Day\n")).toBe("café @… day");
    expect(normaliseText(null)).toBe("");
  });

  it("same platform_post_id → 'id'", () => {
    const r = matchAccountPost(post, [item({ platformPostId: "18000000000000001", caption: "different" })]);
    expect(r).toEqual({ batchItemId: "bi-1", matchedBy: "id" });
  });

  it("same normalised caption within ±36 h → 'caption'; outside → by hand", () => {
    expect(matchAccountPost(post, [item({})])).toEqual({ batchItemId: "bi-1", matchedBy: "caption" });
    expect(matchAccountPost({ ...post, publishedAt: "2026-11-12T06:00:00Z" }, [item({})])).toEqual({ batchItemId: null, matchedBy: null }); // +37 h
  });

  it("the ±36 h edge", () => {
    expect(matchAccountPost({ ...post, publishedAt: "2026-11-12T05:00:00Z" }, [item({})]).matchedBy).toBe("caption"); // exactly +36 h
    expect(matchAccountPost({ ...post, publishedAt: "2026-11-12T05:00:01Z" }, [item({})]).matchedBy).toBeNull();
    expect(matchAccountPost({ ...post, publishedAt: "2026-11-09T04:59:59Z" }, [item({})]).matchedBy).toBeNull();
  });

  it("other platform or different caption → by hand", () => {
    expect(matchAccountPost(post, [item({ platform: "youtube" })]).matchedBy).toBeNull();
    expect(matchAccountPost(post, [item({ caption: "Leg day" })]).matchedBy).toBeNull();
    expect(matchAccountPost({ ...post, caption: null }, [item({})]).matchedBy).toBeNull();
  });

  it("an item that already has another post id is not caption-matched", () => {
    expect(matchAccountPost(post, [item({ platformPostId: "18000000000000999" })]).matchedBy).toBeNull();
  });

  it("YouTube: the title matches the item title, or the caption's first line when the item has none", () => {
    const yt = { platform: "youtube" as const, platformPostId: "vidAAAAAAA2", caption: "whatever", title: "Full push day, every set.", publishedAt: "2026-11-10T18:00:00Z" };
    expect(matchAccountPost(yt, [item({ platform: "youtube", caption: "Full push day, every set.\n\n#gym", scheduledFor: "2026-11-10T18:00:00Z" })]).matchedBy).toBe("caption");
    expect(matchAccountPost(yt, [item({ platform: "youtube", title: "Full push day, every set.", caption: "x", scheduledFor: "2026-11-10T18:00:00Z" })]).matchedBy).toBe("caption");
  });

  it("never overwrites an 'id' match with a caption match; upgrades a caption match to 'id'", () => {
    const existing = { batchItemId: "bi-old", matchedBy: "id" as const };
    expect(matchAccountPost(post, [item({ batchItemId: "bi-new" })], existing)).toEqual(existing);
    expect(matchAccountPost(post, [item({ batchItemId: "bi-new", platformPostId: post.platformPostId })], { batchItemId: "bi-old", matchedBy: "caption" })).toEqual({ batchItemId: "bi-new", matchedBy: "id" });
  });

  it("picks the closest item in time; one item is claimed by at most one post", () => {
    const items = [item({ batchItemId: "a", scheduledFor: "2026-11-10T05:00:00Z" }), item({ batchItemId: "b", scheduledFor: "2026-11-10T16:00:00Z" })];
    expect(matchAccountPost(post, items).batchItemId).toBe("b");
    const twin = { ...post, platformPostId: "18000000000000002", publishedAt: "2026-11-10T16:30:00Z" };
    const r = matchAccountPosts([post, twin], items);
    expect(r.map((x) => x.batchItemId).sort()).toEqual(["a", "b"]);
  });

  it("id matches win the claim over caption matches", () => {
    const items = [item({ batchItemId: "a", platformPostId: "18000000000000002" })];
    const twin = { ...post, platformPostId: "18000000000000002" };
    const r = matchAccountPosts([post, twin], items);
    expect(r).toEqual([{ batchItemId: null, matchedBy: null }, { batchItemId: "a", matchedBy: "id" }]);
  });
});
