import { describe, expect, it } from "vitest";
import { CAP_LIMITS, DEFAULT_CADENCE } from "@autopilot/core";
import { capsChangeMessage, parseCapsForm } from "../caps.js";
import { capHelper } from "../view.js";

const form = (o: Record<string, string>) => (k: string) => (k in o ? o[k]! : null);

describe("caps form", () => {
  it("parses whole numbers within CAP_LIMITS; missing fields are left alone", () => {
    expect(parseCapsForm(form({ "cap-instagram": "4", "cap-tiktok": " 15 " }))).toEqual({ ok: true, caps: { instagram: 4, tiktok: 15 } });
  });
  it("rejects values above CAP_LIMITS, negatives, decimals and text", () => {
    expect(parseCapsForm(form({ "cap-instagram": String(CAP_LIMITS.instagram + 1) }))).toEqual({ ok: false, error: "instagram: at most 25 a day (platform limit)" });
    expect(parseCapsForm(form({ "cap-snapchat": "2" })).ok).toBe(false);
    for (const bad of ["-1", "2.5", "five", ""]) expect(parseCapsForm(form({ "cap-youtube": bad })).ok).toBe(false);
  });
  it("change message lists only changed platforms", () => {
    const before = { ...DEFAULT_CADENCE.dailyCaps, instagram: 4 };
    expect(capsChangeMessage(before, { ...before, instagram: 5 })).toBe("cap instagram 4→5");
    expect(capsChangeMessage(before, before)).toBe("");
  });
  it("helper says default or saved", () => {
    const base = { stored: {}, defaults: DEFAULT_CADENCE.dailyCaps, limits: CAP_LIMITS };
    expect(capHelper("instagram", base)).toBe("Default · max 25");
    expect(capHelper("instagram", { ...base, stored: { instagram: 4 } })).toBe("Saved · default 5 · max 25");
  });
});
