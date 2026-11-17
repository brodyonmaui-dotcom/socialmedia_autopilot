import { describe, expect, it } from "vitest";
import { aiNotesLine, autoOk, lastRunLine, parseModeChange, pauseCopy, resumeOk, shortDate, zoneNotice } from "../replies.js";

describe("settings: replies", () => {
  it("off and drafts-only need no word; Auto needs 'auto' typed", () => {
    expect(parseModeChange("instagram", "off", "")).toEqual({ ok: true, platform: "instagram", mode: "off" });
    expect(parseModeChange("youtube", "shadow", undefined)).toEqual({ ok: true, platform: "youtube", mode: "shadow" });
    expect(parseModeChange("tiktok", "live", "")).toEqual({ ok: false, error: 'type "auto" to turn on auto replies' });
    expect(parseModeChange("tiktok", "live", "yes")).toMatchObject({ ok: false });
    expect(parseModeChange("tiktok", "live", "  Auto ")).toEqual({ ok: true, platform: "tiktok", mode: "live" });
  });

  it("refuses unknown platforms and modes (Snapchat has no reply mode)", () => {
    expect(parseModeChange("snapchat", "off", "")).toEqual({ ok: false, error: "unknown platform" });
    expect(parseModeChange("instagram", "auto", "auto")).toEqual({ ok: false, error: "unknown mode" });
    expect(parseModeChange(undefined, "off", "")).toMatchObject({ ok: false });
  });

  it("typed words", () => {
    expect(autoOk("AUTO")).toBe(true);
    expect(autoOk("autopilot")).toBe(false);
    expect(resumeOk(" resume ")).toBe(true);
  });

  it("AI notes row is read-only text with the month's tokens", () => {
    expect(aiNotesLine({ on: false, tokensUsedThisMonth: 12400 })).toBe("Off · needs your OK in chat · 12,400 tokens used this month");
    expect(aiNotesLine({ on: false, tokensUsedThisMonth: 0 })).toBe("Off · needs your OK in chat · 0 tokens used this month");
    expect(aiNotesLine({ on: true, tokensUsedThisMonth: 1 })).toBe("On · 1 token used this month");
  });

  it("research run line", () => {
    expect(lastRunLine(null, "UTC")).toBe("Hasn't run yet");
    const run = { startedAt: "2026-11-15T06:00:00Z", finishedAt: "2026-11-15T06:04:00Z", status: "ok", ideasAdded: 12, hooksAdded: 1 };
    expect(lastRunLine(run, "UTC")).toBe("Nov 15 · 12 ideas and 1 hook added");
    expect(lastRunLine({ ...run, status: "failed" }, "UTC")).toBe("Nov 15 · didn't finish");
    expect(shortDate("2026-11-30T23:30:00Z", "UTC")).toBe("Nov 30");
  });

  it("time-zone notice only when the zone isn't set", () => {
    expect(zoneNotice("env")).toBeNull();
    expect(zoneNotice("fallback")).toMatch(/set on the server; see the Snapchat handoff runbook/);
  });

  it("pause dialog proposes the opposite of the current state", () => {
    expect(pauseCopy(false).confirm).toBe("Pause replies");
    expect(pauseCopy(true).confirm).toBe("Resume");
  });
});
