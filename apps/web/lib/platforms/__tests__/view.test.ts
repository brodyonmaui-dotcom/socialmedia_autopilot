import { describe, expect, it } from "vitest";
import { DEFAULT_ENGAGEMENT } from "@autopilot/engagement/src/settings.js";
import type { Entry, PlatformEntry } from "../../calendar/model.js";
import { connectionView, dayLabel, followerNote, fmtCount, fmtRate, parsePlatform, replyView, routeSentence, todayView, tokenService, upcomingFor } from "../view.js";

const item = (over: Partial<PlatformEntry>): PlatformEntry => ({
  itemId: "i1",
  batchId: "b1",
  platform: "instagram",
  time: "10:38",
  time12: "10:38 AM",
  state: "approved",
  fix: null,
  scheduledFor: "2026-11-18T10:38:00.000Z",
  status: "approved",
  statusLabel: "Approved",
  tone: "neutral",
  text: { caption: "", title: null },
  warnings: [],
  canApprove: false,
  canEdit: false,
  canReset: false,
  canRecord: false,
  tiktokDraft: false,
  origin: null,
  shareByHand: false,
  attempts: 0,
  lastError: null,
  keyTail: null,
  ...over,
});
const entry = (day: string, platforms: PlatformEntry[], title = `clip ${day}`): Entry => ({
  key: `m-${day}|${day}`,
  mediaId: `m-${day}`,
  day,
  title,
  caption: "",
  pillar: "gym",
  durationS: 20,
  platforms,
  status: "approved",
  statusLabel: "Approved",
  tone: "neutral",
  firstTime: platforms[0]?.time ?? null,
  needsYou: false,
  fromEditor: false,
});

describe("platforms view", () => {
  it("parses only the four platform slugs", () => {
    expect(parsePlatform("instagram")).toBe("instagram");
    expect(parsePlatform("snapchat")).toBe("snapchat");
    for (const bad of ["Instagram", "x", "", undefined, ["tiktok"]]) expect(parsePlatform(bad)).toBeNull();
  });

  it("says how posts go out, from the capability matrix, in one sentence", () => {
    expect(routeSentence("instagram")).toMatch(/official API/);
    expect(routeSentence("youtube")).toMatch(/private.*public on schedule/);
    expect(routeSentence("tiktok")).toMatch(/Zernio/);
    expect(routeSentence("snapchat")).toMatch(/share sheet, one Spotlight a day/);
    for (const p of ["instagram", "youtube", "tiktok", "snapchat"] as const) expect(routeSentence(p).split(". ").length).toBeLessThanOrEqual(2);
  });

  it("maps token health from the newest open alert", () => {
    expect(tokenService("tiktok")).toBe("zernio");
    expect(connectionView("snapchat", null).label).toBe("Not needed");
    expect(connectionView("instagram", null)).toMatchObject({ label: "No problems", tone: "neutral" });
    expect(connectionView("instagram", { message: "warn: expires in 6 days", createdAt: "" })).toMatchObject({ label: "Login expires soon", tone: "warn", detail: "expires in 6 days" });
    expect(connectionView("youtube", { message: "fail: refresh token revoked", createdAt: "" })).toMatchObject({ label: "Login needs renewing", tone: "danger" });
  });

  it("today vs cap", () => {
    expect(todayView({ sent: 2, planned: 3 }, 6)).toEqual({ value: "2 of 6", note: "3 more planned today", full: false });
    expect(todayView({ sent: 0, planned: 1 }, 1).note).toBe("1 more planned today");
    expect(todayView({ sent: 1, planned: 0 }, 1)).toMatchObject({ note: "Daily limit reached", full: true });
    expect(todayView({ sent: 0, planned: 0 }, 0).full).toBe(true);
  });

  it("reply mode words; Auto shows Paused while killed", () => {
    expect(replyView("instagram", DEFAULT_ENGAGEMENT).label).toBe("Drafts only");
    expect(replyView("tiktok", DEFAULT_ENGAGEMENT).label).toBe("Drafts only");
    const live = { ...DEFAULT_ENGAGEMENT, mode: { ...DEFAULT_ENGAGEMENT.mode, youtube: "live" as const } };
    expect(replyView("youtube", live)).toMatchObject({ label: "Auto", tone: "accent" });
    expect(replyView("youtube", { ...live, killed: true }).label).toBe("Paused");
    expect(replyView("youtube", live, true).label).toBe("Paused");
    expect(replyView("snapchat", DEFAULT_ENGAGEMENT).label).toBe("None");
  });

  it("next posts: this platform only, future, not rejected or posted, soonest first, at most 5", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    const entries = [
      entry("2026-11-20", [item({ itemId: "late", scheduledFor: "2026-11-20T10:00:00Z", time: "10:00" }), item({ itemId: "yt", platform: "youtube", scheduledFor: "2026-11-20T11:00:00Z" })]),
      entry("2026-11-17", [item({ itemId: "past", scheduledFor: "2026-11-17T09:00:00Z" }), item({ itemId: "rej", status: "rejected", scheduledFor: "2026-11-17T15:00:00Z" })]),
      entry("2026-11-18", [item({ itemId: "soon", scheduledFor: "2026-11-18T09:00:00Z", time: "09:00" })]),
      ...["21", "22", "23", "24"].map((d) => entry(`2026-11-${d}`, [item({ itemId: `d${d}`, scheduledFor: `2026-11-${d}T09:00:00Z` })])),
    ];
    const rows = upcomingFor(entries, "instagram", now, "2026-11-17");
    expect(rows.map((r) => r.itemId)).toEqual(["soon", "late", "d21", "d22", "d23"]);
    expect(rows[0]).toMatchObject({ when: "Tomorrow · 09:00", href: "/calendar?day=2026-11-18" });
    expect(rows[1]!.when).toBe("Fri, Nov 20 · 10:00");
  });

  it("formats numbers without inventing zeros", () => {
    expect(dayLabel("2026-11-17", "2026-11-17")).toBe("Today");
    expect(fmtCount(null)).toBeNull();
    expect(fmtCount(12400)).toBe("12,400");
    expect(fmtRate(0.042)).toBe("4.2%");
    expect(followerNote(120, 30)).toBe("+120 in 30 days");
    expect(followerNote(-3, 30)).toBe("−3 in 30 days");
    expect(followerNote(null, 30)).toBeNull();
  });
});
