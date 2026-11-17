import { describe, expect, it } from "vitest";
import { buildResponse, cleanQuery, likePattern, matchPages, oneLine, shapeClips, shapeIdeas, shapePosts, type PostRow } from "../shape.js";

describe("query cleaning", () => {
  it("needs 2+ characters, trims, collapses spaces, caps at 80", () => {
    expect(cleanQuery("a")).toBeNull();
    expect(cleanQuery("  ")).toBeNull();
    expect(cleanQuery(42)).toBeNull();
    expect(cleanQuery("  leg   day ")).toBe("leg day");
    expect(cleanQuery("x".repeat(200))!.length).toBe(80);
  });
  it("escapes LIKE wildcards so input matches literally", () => {
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});

describe("result shaping", () => {
  it("pages match label or keywords, max 5", () => {
    const pages = [
      { label: "Analytics", href: "/analytics", keywords: "analytics" },
      { label: "Analytics · YouTube", href: "/analytics/youtube", keywords: "analytics youtube" },
      { label: "Inbox", href: "/inbox", keywords: "inbox" },
    ];
    expect(matchPages(pages, "you").map((r) => r.href)).toEqual(["/analytics/youtube"]);
    expect(matchPages(pages, "ANALY")).toHaveLength(2);
  });

  it("posts: one result per clip per day, platforms joined, linked to the calendar day in the creator zone", () => {
    const base = { media_id: "m1", source_path: "/x/leg-day.mp4", title: null, caption: "Leg day\n#gym", status: "approved" };
    const rows: PostRow[] = [
      { ...base, id: "a", platform: "instagram", scheduled_for: "2026-11-18T17:00:00Z" },
      { ...base, id: "b", platform: "youtube", scheduled_for: "2026-11-18T18:00:00Z" },
      { ...base, id: "c", platform: "tiktok", scheduled_for: null, status: "draft" },
    ];
    const r = shapePosts(rows, "UTC");
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ id: "post:a", title: "Leg day", meta: "Wed, Nov 18 · Instagram, YouTube · Scheduled", href: "/calendar?day=2026-11-18" });
    expect(r[1]!.href).toBe("/calendar");
    expect(r[1]!.meta).toContain("No time yet");
    // A zone east of UTC moves a late-evening post to the next day.
    expect(shapePosts([{ ...base, id: "d", platform: "instagram", scheduled_for: "2026-11-18T23:30:00Z" }], "Etc/GMT-2")[0]!.href).toBe("/calendar?day=2026-11-19");
  });

  it("ideas first, then hooks; clips link to the library search", () => {
    const i = shapeIdeas([
      { id: "h1", kind: "hook", text: "Stop doing this", pillar: null },
      { id: "i1", kind: "idea", text: "Morning routine", pillar: "gym" },
    ]);
    expect(i.map((x) => x.id)).toEqual(["idea:i1", "hook:h1"]);
    expect(i[0]).toMatchObject({ meta: "Idea · Gym", href: "/research/ideas" });
    expect(i[1]!.href).toBe("/research/hooks");
    const c = shapeClips([{ id: "m1", source_path: "/in/leg day.mov", pillar: "gym", duration_s: "42" }]);
    expect(c[0]).toEqual({ id: "clip:m1", title: "leg day", meta: "Clip · Gym · 0:42", href: "/library?q=leg%20day" });
  });

  it("groups in fixed order, empty ones dropped, max 5 each", () => {
    const many = Array.from({ length: 8 }, (_, n) => ({ id: `${n}`, title: "t", meta: "m", href: "/" }));
    const res = buildResponse("q", { clips: many, pages: [], posts: many.slice(0, 1) });
    expect(res.groups.map((g) => g.label)).toEqual(["Posts", "Clips"]);
    expect(res.groups[1]!.results).toHaveLength(5);
  });

  it("oneLine takes the first non-empty line and cuts with an ellipsis", () => {
    expect(oneLine("\n  hello \nworld")).toBe("hello");
    expect(oneLine("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
