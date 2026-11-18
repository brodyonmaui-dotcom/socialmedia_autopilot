import { describe, expect, it } from "vitest";
import { orderedChecklist, resultText, shareHint, shareLabel, suggestionMeta } from "../view.js";

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

describe("share button copy", () => {
  it("renames the machine labels without changing the two-tap flow", () => {
    expect(shareLabel("Prepare")).toBe("Share to Snapchat");
    expect(shareLabel("Prepare again")).toBe("Try again");
    expect(shareHint({ kind: "ready", sizeMb: "2.5" })).toBe("Ready (2.5 MB). Tap again to open the share sheet.");
    expect(shareHint({ kind: "blocked" })).toBeNull();
    expect(shareLabel("Share (2.5 MB)")).toBe("Share to Snapchat · 2.5 MB");
    expect(shareLabel("Share (blocked)")).toBe("Share blocked");
    expect(shareLabel("Sharing…")).toBe("Sharing…");
  });
});

it("suggestionMeta", () => {
  expect(suggestionMeta({ platform: "tiktok", score: 2.43, views: 12400 })).toBe("2.4× the TikTok median · 12,400 views");
});
