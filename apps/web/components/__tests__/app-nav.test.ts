import { describe, expect, it } from "vitest";
import { badgeOf, buildNav, moreLinks, tabFor } from "../app-nav.js";
import { FRAME_COUNT_SQL } from "../frame-counts.js";

describe("buildNav", () => {
  it("is the five tabs in order with basePath-free hrefs", () => {
    const nav = buildNav();
    expect(nav.map((n) => n.id)).toEqual(["home", "batches", "inbox", "analytics", "more"]);
    expect(nav.map((n) => n.href)).toEqual(["/", "/batches", "/inbox", "/analytics", "/more"]);
    for (const n of nav) expect(n.href.startsWith("/app")).toBe(false);
    expect(nav.every((n) => n.badge === undefined)).toBe(true);
  });
  it("puts draft batches, flagged and open alerts on Batches, Inbox and More", () => {
    const nav = buildNav({ draftBatches: 2, flagged: 7, openAlerts: 3 });
    const b = Object.fromEntries(nav.map((n) => [n.id, n.badge]));
    expect(b).toEqual({ home: undefined, batches: 2, inbox: 7, analytics: undefined, more: 3 });
  });
  it("hides zero, negative, NaN and unknown counts", () => {
    expect(badgeOf(0)).toBeUndefined();
    expect(badgeOf(-1)).toBeUndefined();
    expect(badgeOf(Number.NaN)).toBeUndefined();
    expect(badgeOf(undefined)).toBeUndefined();
    expect(badgeOf(4)).toBe(4);
  });
});

describe("tabFor", () => {
  it("maps tabs to themselves and More pages to more", () => {
    for (const t of ["home", "batches", "inbox", "analytics", "more"]) expect(tabFor(t)).toBe(t);
    for (const p of ["alerts", "handoff", "library", "touch-up", "research"]) expect(tabFor(p)).toBe("more");
    expect(tabFor("login")).toBe("");
  });
});

describe("moreLinks", () => {
  it("lists every secondary page once, alerts first with the open count", () => {
    const links = moreLinks({ openAlerts: 2 });
    expect(links.map((l) => l.href)).toEqual(["/alerts", "/handoff", "/library", "/touch-up", "/research"]);
    expect(links[0]!.badge).toBe(2);
    expect(links.slice(1).every((l) => l.badge === undefined)).toBe(true);
    expect(moreLinks()[0]!.badge).toBeUndefined();
  });
});

describe("frame count SQL", () => {
  it("is read-only and matches Home's queries", () => {
    for (const q of Object.values(FRAME_COUNT_SQL)) expect(q).toMatch(/^select count\(\*\)::int as n from /);
    expect(FRAME_COUNT_SQL.openAlerts).toContain("acknowledged_at is null");
    expect(FRAME_COUNT_SQL.flagged).toContain("bucket in ('flag', 'hide_flag') and handled_at is null");
  });
});
