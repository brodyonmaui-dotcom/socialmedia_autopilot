import { describe, expect, it } from "vitest";
import { activeState, badgeOf, inboxBadge, navId, pageLinks, sidebarNav } from "../app-nav.js";
import { FRAME_COUNT_SQL } from "../frame-counts.js";

describe("sidebarNav", () => {
  it("is the v3 sidebar in order with basePath-free hrefs", () => {
    const nav = sidebarNav();
    expect(nav.map((n) => n.label)).toEqual(["Home", "Calendar", "Inbox", "Analytics", "Research", "Library", "Platforms", "Settings"]);
    const hrefs = nav.flatMap((n) => [n.href, ...(n.children ?? []).map((c) => c.href)]);
    for (const h of hrefs) expect(h.startsWith("/app")).toBe(false);
    expect(nav.find((n) => n.id === "analytics")!.children!.map((c) => c.label)).toEqual(["Overview", "Instagram", "YouTube", "TikTok", "Snapchat"]);
    expect(nav.find((n) => n.id === "library")!.children!.map((c) => c.href)).toEqual(["/library", "/library/touch-up"]);
    expect(nav.find((n) => n.id === "platforms")!.children!.map((c) => c.href)).toEqual([
      "/platforms/instagram",
      "/platforms/youtube",
      "/platforms/tiktok",
      "/platforms/snapchat",
    ]);
    expect(nav.every((n) => n.badge === undefined)).toBe(true);
  });

  it("Touch-up badge = clips with open touch-up issues; zero or unknown shows none", () => {
    const touch = (c: Parameters<typeof sidebarNav>[0]) => sidebarNav(c).find((n) => n.id === "library")!.children!.find((c) => c.id === "library/touch-up")!.badge;
    expect(touch({ touchUp: 4 })).toBe(4);
    expect(touch({ touchUp: 0 })).toBeUndefined();
    expect(touch({})).toBeUndefined();
    expect(FRAME_COUNT_SQL.touchUp).toContain("@.severity == \"fix\"");
    expect(FRAME_COUNT_SQL.touchUp).toContain("td.undone_at is null");
    expect(FRAME_COUNT_SQL.touchUp).toContain("k.status in ('kept','discarded')");
  });

  it("never says 'batch' or 'More'", () => {
    const words = sidebarNav().flatMap((n) => [n.label, ...(n.children ?? []).map((c) => c.label)]).join(" ");
    expect(words).not.toMatch(/batch|more/i);
  });

  it("badges: Calendar = draft posts, Inbox = flagged + DMs waiting", () => {
    const nav = sidebarNav({ draftPosts: 6, flagged: 2, dmsOpen: 1, openAlerts: 3 });
    const b = Object.fromEntries(nav.map((n) => [n.id, n.badge]));
    expect(b.calendar).toBe(6);
    expect(b.inbox).toBe(3);
    expect(b.home).toBeUndefined();
  });
});

describe("activeState", () => {
  const nav = sidebarNav();
  it("marks one link and opens the group that holds it", () => {
    expect(activeState(nav, "analytics/youtube")).toEqual({ entryId: "analytics", linkHref: "/analytics/youtube", openGroups: ["analytics"] });
    expect(activeState(nav, "analytics")).toEqual({ entryId: "analytics", linkHref: "/analytics", openGroups: ["analytics"] });
    expect(activeState(nav, "home")).toEqual({ entryId: "home", linkHref: "/", openGroups: [] });
  });
  it("maps the v2 ids pages still pass", () => {
    expect(navId("batches")).toBe("calendar");
    expect(activeState(nav, "batches").linkHref).toBe("/calendar");
    expect(activeState(nav, "handoff")).toMatchObject({ linkHref: "/platforms/snapchat", openGroups: ["platforms"] });
    expect(activeState(nav, "touch-up")).toMatchObject({ linkHref: "/library/touch-up", openGroups: ["library"] });
    expect(activeState(nav, "more").linkHref).toBe("/settings");
  });
  it("lights nothing for pages outside the sidebar", () => {
    expect(activeState(nav, "notifications")).toEqual({ entryId: null, linkHref: null, openGroups: [] });
    expect(activeState(nav, "alerts").linkHref).toBeNull();
  });
});

describe("badges", () => {
  it("hides zero, negative, NaN and unknown counts", () => {
    expect(badgeOf(0)).toBeUndefined();
    expect(badgeOf(-1)).toBeUndefined();
    expect(badgeOf(Number.NaN)).toBeUndefined();
    expect(badgeOf(undefined)).toBeUndefined();
    expect(badgeOf(4)).toBe(4);
  });
  it("inbox badge adds what is known; all unknown → none", () => {
    expect(inboxBadge({})).toBeUndefined();
    expect(inboxBadge({ flagged: 2 })).toBe(2);
    expect(inboxBadge({ flagged: 0, dmsOpen: 0 })).toBeUndefined();
  });
});

describe("pageLinks (search Pages group)", () => {
  it("lists every sidebar destination plus Notifications, once each", () => {
    const links = pageLinks();
    const hrefs = links.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toContain("/notifications");
    expect(links.find((l) => l.href === "/analytics/tiktok")!.label).toBe("Analytics · TikTok");
    expect(links.find((l) => l.href === "/library")!.label).toBe("Library");
  });
});

describe("frame count SQL", () => {
  it("is read-only counts", () => {
    for (const q of Object.values(FRAME_COUNT_SQL)) expect(q).toMatch(/^select count\(\*\)::int as n from /);
    expect(FRAME_COUNT_SQL.openAlerts).toContain("acknowledged_at is null");
    expect(FRAME_COUNT_SQL.flagged).toContain("bucket in ('flag', 'hide_flag') and handled_at is null");
    expect(FRAME_COUNT_SQL.draftPosts).toContain("status = 'draft'");
  });
});

describe("nav icons", () => {
  it("every sidebar entry has its own icon, distinct from the theme toggle's sun/moon", async () => {
    const { PATHS } = await import("../ui/Icon");
    const icons = sidebarNav().map((e) => e.icon);
    expect(new Set(icons).size).toBe(icons.length);
    const drawn = icons.map((i) => PATHS[i as keyof typeof PATHS]);
    expect(new Set(drawn).size).toBe(drawn.length);
    for (const d of drawn) {
      expect(d).not.toBe(PATHS.sun);
      expect(d).not.toBe(PATHS.moon);
    }
  });
});
