import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { discoveryUrl, fetchCreatorSnapshot, toSnapshot, type FetchLike } from "../discovery.js";
import type { Creator } from "../types.js";

const body = JSON.parse(readFileSync(new URL("./fixtures/business-discovery.json", import.meta.url), "utf8"));
const creator = (over: Partial<Creator> = {}): Creator => ({
  id: "c1", platform: "instagram", handle: "demo_lifter", pillar: "gym", notes: "", followers: null, active: true, lastCheckedAt: null, createdAt: "2026-11-01T00:00:00Z", ...over,
});
const cfg = (fetch: FetchLike) => ({ igUserId: "17841405309211844", accessToken: "tok", fetch });

describe("toSnapshot (documented Business Discovery shape)", () => {
  const snap = toSnapshot("c1", body);
  it("maps followers and every media item", () => {
    expect(snap.followers).toBe(267793);
    expect(snap.posts).toHaveLength(4);
  });
  it("reel vs video vs carousel vs image comes from media_product_type + media_type", () => {
    expect(snap.posts.map((p) => p.mediaType)).toEqual(["reel", "carousel", "image", "video"]);
  });
  it("hidden likes → null (not 0); missing caption → empty; views only where reported", () => {
    expect(snap.posts[1]!.likes).toBeNull();
    expect(snap.posts[2]!.caption).toBe("");
    expect(snap.posts[0]!.views).toBe(7757);
    expect(snap.posts[3]!.views).toBeNull();
  });
  it("parses Graph's +0000 timestamps", () => {
    expect(snap.posts[0]!.postedAt).toBe("2026-11-09T18:00:04.000Z");
  });
  it("throws when business_discovery is absent (personal / age-gated account)", () => {
    expect(() => toSnapshot("c1", { id: "1" })).toThrow(/no business_discovery/);
  });
});

describe("discoveryUrl", () => {
  it("builds one nested request with the field list, encoded, token not in the URL", () => {
    const url = discoveryUrl("demo_lifter", { igUserId: "17841405309211844", limit: 10 });
    expect(url.startsWith("https://graph.facebook.com/v25.0/17841405309211844?fields=")).toBe(true);
    expect(decodeURIComponent(url)).toContain("business_discovery.username(demo_lifter){followers_count,media_count,media.limit(10){id,caption,like_count,comments_count,view_count,media_type,media_product_type,timestamp}}");
  });
  it("refuses handles that could inject into the field expansion, and caps the limit", () => {
    expect(() => discoveryUrl("bad){id}", { igUserId: "1" })).toThrow(/handle/);
    expect(() => discoveryUrl("Upper", { igUserId: "1" })).toThrow(/handle/);
    expect(() => discoveryUrl("ok", { igUserId: "me" })).toThrow(/numeric/);
    expect(decodeURIComponent(discoveryUrl("ok", { igUserId: "1", limit: 500 }))).toContain("media.limit(50)");
  });
});

describe("fetchCreatorSnapshot", () => {
  it("GETs with a Bearer header and returns the snapshot", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const snap = await fetchCreatorSnapshot(creator(), cfg(async (url, init) => { calls.push({ url, headers: init.headers }); return { status: 200, json: async () => body }; }));
    expect(snap.creatorId).toBe("c1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.Authorization).toBe("Bearer tok");
    expect(calls[0]!.url).not.toContain("tok");
  });
  it("surfaces Graph errors with code, and refuses non-Instagram creators", async () => {
    const err = cfg(async () => ({ status: 400, json: async () => ({ error: { code: 110, message: "Invalid user id" } }) }));
    await expect(fetchCreatorSnapshot(creator(), err)).rejects.toThrow(/HTTP 400 code 110 Invalid user id/);
    await expect(fetchCreatorSnapshot(creator({ platform: "tiktok" }), err)).rejects.toThrow(/Instagram only/);
  });
});
