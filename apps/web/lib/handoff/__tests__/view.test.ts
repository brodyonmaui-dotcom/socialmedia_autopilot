import { describe, expect, it } from "vitest";
import { dailyProgress, heroLines, orderedChecklist, pulseFor, resultText, shareLabel, shareStep, suggestionMeta, todayMeta } from "../view.js";

const CHECKLIST = [
  "Share → Snapchat → Spotlight (not Story).",
  "Keep Snap Map / location OFF on the posting screen.",
  "If the share sheet is blank, open Snapchat once, then retry.",
  "One Spotlight a day; skipped days just roll forward.",
];

describe("orderedChecklist", () => {
  it("puts the location / Snap Map line first and keeps the rest in order", () => {
    const out = orderedChecklist(CHECKLIST);
    expect(out[0]).toEqual({ text: CHECKLIST[1], privacy: true });
    expect(out.slice(1).map((l) => l.text)).toEqual([CHECKLIST[0], CHECKLIST[2], CHECKLIST[3]]);
    expect(out.filter((l) => l.privacy)).toHaveLength(1);
  });
  it("is empty-safe", () => expect(orderedChecklist([])).toEqual([]));
});

describe("resultText", () => {
  it("ok with and without a target day", () => {
    expect(resultText({ ok: true }, "Marked posted")).toBe("Marked posted.");
    expect(resultText({ ok: true, to: "2026-11-15" }, "Skipped")).toBe("Skipped: moved to 2026-11-15.");
  });
  it("stale rows become a reload hint; other reasons are capped", () => {
    expect(resultText({ ok: false, reason: "not found" }, "x")).toBe("Changed underneath: reload.");
    expect(resultText({ ok: false, reason: "y".repeat(300) }, "x")).toHaveLength(160);
  });
});

describe("daily progress + hero", () => {
  it("caps at 1 a day", () => {
    expect(dailyProgress(0)).toEqual({ value: 0, max: 1, text: "0/1" });
    expect(dailyProgress(3)).toEqual({ value: 1, max: 1, text: "1/1 done" });
    expect(heroLines(2).at(-1)?.text).toBe("1/1");
  });
  it("pulse tone: due → accent, missed only → warn, idle → muted", () => {
    expect(pulseFor(1, 2, 0)).toEqual({ label: "1 to share today", tone: "accent" });
    expect(pulseFor(0, 2, 0)).toEqual({ label: "2 missed items", tone: "warn" });
    expect(pulseFor(0, 0, 1).tone).toBe("accent");
    expect(pulseFor(0, 0, 0)).toEqual({ label: "Nothing due", tone: "muted" });
  });
  it("today meta counts blocked items", () => {
    expect(todayMeta([{ blocks: [] }])).toBe("1 due · 1 per day");
    expect(todayMeta([{ blocks: ["x"] }, { blocks: [] }])).toBe("2 due · 1 blocked");
  });
});

describe("share button copy", () => {
  it("renames the machine labels without changing the two-tap flow", () => {
    expect(shareLabel("Prepare")).toBe("Prepare clip");
    expect(shareLabel("Share (2.5 MB)")).toBe("Share to Snapchat · 2.5 MB");
    expect(shareLabel("Share (blocked)")).toBe("Share blocked");
    expect(shareLabel("Sharing…")).toBe("Sharing…");
  });
  it("step readout", () => {
    expect(shareStep({ kind: "idle" })).toBe("1/2");
    expect(shareStep({ kind: "error" })).toBe("1/2");
    expect(shareStep({ kind: "error", file: {} })).toBe("2/2");
    expect(shareStep({ kind: "ready", file: {} })).toBe("2/2");
  });
});

it("suggestionMeta", () => {
  expect(suggestionMeta({ platform: "tiktok", score: 2.43, views: 12400 })).toBe("2.4× the TikTok median · 12,400 views");
});
