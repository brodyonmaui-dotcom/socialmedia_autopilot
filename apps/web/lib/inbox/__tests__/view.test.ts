import { describe, expect, it } from "vitest";
import {
  actionBadge,
  bucketChip,
  commentTabs,
  dmWindowTone,
  enginePulse,
  heroLines,
  killSheet,
  lastMessages,
  limitReadout,
  modePulse,
  needsYou,
  primaryTabs,
  replyLabel,
  resumeOk,
  sentLast24h,
} from "../view.js";

const C = { flagged: 3, shadow: 12, dmsOpen: 2 };
const NOW = new Date("2026-11-14T12:00:00Z");
const LIMITS = { perPersonDays: 7, perPlatformPerHour: 10, perPlatformPerDay: 40, globalPerDay: 80 };
const MODE = { instagram: "shadow", youtube: "shadow", tiktok: "off" } as const;

describe("hero + tabs", () => {
  it("needs you = flagged + open DMs, padded in the display", () => {
    expect(needsYou(C)).toBe(5);
    expect(heroLines(C).map((l) => l.text)).toEqual(["Inbox", "needs you", "05"]);
    expect(needsYou({ flagged: -1, shadow: 0, dmsOpen: 0 })).toBe(0);
  });
  it("keeps the existing routes and query params", () => {
    expect(primaryTabs(false, C).map((t) => [t.href, t.active, t.count])).toEqual([
      ["/inbox", true, 3],
      ["/inbox/dms", false, 2],
    ]);
    expect(commentTabs("shadow", C).map((t) => [t.href, t.active])).toEqual([
      ["/inbox", false],
      ["/inbox?tab=shadow", true],
      ["/inbox?tab=sent", false],
    ]);
    expect(commentTabs("sent", C)[2]?.count).toBeUndefined();
  });
});

describe("labels and tones", () => {
  it("maps triage buckets with no green tone", () => {
    expect(bucketChip("hide_flag")).toEqual({ label: "Hide + flag", tone: "danger" });
    expect(bucketChip("simple_positive")?.tone).toBe("neutral");
    expect(bucketChip("new_kind")).toEqual({ label: "new kind", tone: "neutral" });
    expect(bucketChip(null)).toBeNull();
  });
  it("maps action statuses", () => {
    expect(actionBadge("sent")?.tone).toBe("accent");
    expect(actionBadge("unknown")?.tone).toBe("warn");
    expect(actionBadge("failed")?.tone).toBe("danger");
    expect(actionBadge(undefined)).toBeNull();
    expect(replyLabel("shadow")).toBe("Would reply");
  });
});

describe("mode pulses", () => {
  it("killed wins, then live, then shadow", () => {
    expect(enginePulse({ killed: true, mode: { ...MODE, instagram: "live" } }).tone).toBe("danger");
    expect(enginePulse({ killed: false, mode: { ...MODE, instagram: "live" } })).toEqual({ label: "Live · Instagram", tone: "accent" });
    expect(enginePulse({ killed: false, mode: MODE }).label).toBe("Shadow · nothing sent");
    expect(enginePulse({ killed: false, mode: { instagram: "off", youtube: "off", tiktok: "off" } }).label).toBe("Auto-replies off");
  });
  it("per platform: live is accent, held when killed", () => {
    expect(modePulse("live", false).tone).toBe("accent");
    expect(modePulse("live", true).label).toBe("Live · held");
    expect(modePulse("shadow", false)).toEqual({ label: "Shadow", tone: "muted" });
  });
});

describe("limits", () => {
  const rows = [
    { platform: "instagram" as const, actionStatus: "sent", sentAt: "2026-11-14T11:00:00Z" },
    { platform: "instagram" as const, actionStatus: "sending", sentAt: null },
    { platform: "youtube" as const, actionStatus: "sent", sentAt: "2026-11-13T13:00:00Z" },
    { platform: "youtube" as const, actionStatus: "sent", sentAt: "2026-11-13T11:00:00Z" }, // older than 24 h
    { platform: "instagram" as const, actionStatus: "failed", sentAt: "2026-11-14T11:30:00Z" },
    { platform: "instagram" as const, actionStatus: "unknown", sentAt: null },
  ];
  it("counts sent + sending in the last 24 h", () => {
    expect(sentLast24h(rows, NOW)).toEqual({ all: 3, instagram: 2, youtube: 1, tiktok: 0 });
  });
  it("shows used/limit and what is left, never negative", () => {
    const r = limitReadout(LIMITS, { all: 90, instagram: 2, youtube: 1, tiktok: 0 }, 10);
    expect(r[0]).toEqual({ k: "All · 24 h", v: "90/80 · 0 left" });
    expect(r[1]).toEqual({ k: "Instagram · 24 h", v: "2/40 · 38 left" });
    expect(r.at(-1)).toEqual({ k: "Veto window", v: "10 min" });
  });
});

describe("kill sheet", () => {
  it("says what each direction does", () => {
    expect(killSheet(false).confirm).toBe("Kill auto-replies");
    expect(killSheet(false).points.join(" ")).toMatch(/held, not deleted/);
    expect(killSheet(true).points.join(" ")).toMatch(/ENGAGEMENT_KILL/);
  });
  it("resume needs the word", () => {
    expect(resumeOk(" Resume ")).toBe(true);
    expect(resumeOk("yes")).toBe(false);
  });
});

describe("dms", () => {
  it("window tone", () => {
    expect(dmWindowTone({ open: true, msLeft: 10 * 3_600_000 })).toBe("accent");
    expect(dmWindowTone({ open: true, msLeft: 3_600_000 })).toBe("warn");
    expect(dmWindowTone({ open: false, msLeft: 0 })).toBe("muted");
  });
  it("labels the last three messages", () => {
    const m = [1, 2, 3, 4].map((i) => ({ id: String(i), dir: (i % 2 ? "in" : "out") as "in" | "out" }));
    expect(lastMessages(m).map((x) => `${x.id}${x.who}`)).toEqual(["2You", "3Them", "4You"]);
  });
});
