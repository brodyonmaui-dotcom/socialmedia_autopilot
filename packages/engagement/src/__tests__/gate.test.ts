import { describe, expect, it } from "vitest";
import { sendGate } from "../gate.js";
import { DEFAULT_ENGAGEMENT } from "../settings.js";
import type { EngagementActionRow, EngagementSettings, LimitCounts } from "../types.js";

const NOW = new Date("2026-11-13T12:00:00Z");
const LIVE: EngagementSettings = {
  ...DEFAULT_ENGAGEMENT,
  mode: { instagram: "live", youtube: "live", tiktok: "live" },
  hideEnabled: { instagram: true, youtube: true, tiktok: true },
};
const ZERO: LimitCounts = { platformHour: 0, platformDay: 0, globalDay: 0, authorWindow: 0 };
const ENV = { dryRun: false, killEnv: false };
const CAPS = { canReply: true, canHide: true };
const row = (p: Partial<EngagementActionRow> = {}): EngagementActionRow => ({
  id: "a1", commentId: "c1", platform: "instagram", platformCommentId: "pc1", authorId: "u1", kind: "reply", text: "thanks!",
  idempotencyKey: "k1", status: "planned", notBefore: "2026-11-13T11:00:00Z", attempts: 0, nextAttemptAt: null, origin: "auto",
  createdAt: "2026-11-13T10:50:00Z", ...p,
});

describe("sendGate", () => {
  it("passes a live, due, within-limits reply", () => {
    expect(sendGate(row(), LIVE, ENV, ZERO, NOW, CAPS)).toEqual({ ok: true });
  });
  it("1. dry-run wins over everything", () => {
    const g = sendGate(row(), { ...LIVE, killed: true }, { dryRun: true, killEnv: true }, ZERO, NOW, CAPS);
    expect(g).toMatchObject({ ok: false, reason: "dry-run" });
  });
  it("2. killed by setting or by env", () => {
    expect(sendGate(row(), { ...LIVE, killed: true }, ENV, ZERO, NOW, CAPS)).toMatchObject({ reason: "killed" });
    expect(sendGate(row(), LIVE, { dryRun: false, killEnv: true }, ZERO, NOW, CAPS)).toMatchObject({ reason: "killed" });
  });
  it("3. auto action on a non-live platform → mode", () => {
    expect(sendGate(row(), DEFAULT_ENGAGEMENT, ENV, ZERO, NOW, CAPS)).toMatchObject({ reason: "mode" });
    expect(sendGate(row({ platform: "tiktok" }), { ...LIVE, mode: { ...LIVE.mode, tiktok: "off" } }, ENV, ZERO, NOW, CAPS)).toMatchObject({ reason: "mode" });
  });
  it("4. hide while hide is disabled → mode (hide disabled)", () => {
    const s = { ...LIVE, hideEnabled: { ...LIVE.hideEnabled, instagram: false } };
    expect(sendGate(row({ kind: "hide", text: null }), s, ENV, ZERO, NOW, CAPS)).toEqual({ ok: false, reason: "mode", detail: "hide disabled" });
  });
  it("5. before notBefore → too-early", () => {
    expect(sendGate(row({ notBefore: "2026-11-13T12:05:00Z" }), LIVE, ENV, ZERO, NOW, CAPS)).toMatchObject({ reason: "too-early" });
  });
  it("6. platform hour / platform day / global day limits → limit", () => {
    const l = LIVE.limits;
    expect(sendGate(row(), LIVE, ENV, { ...ZERO, platformHour: l.perPlatformPerHour }, NOW, CAPS)).toMatchObject({ reason: "limit" });
    expect(sendGate(row(), LIVE, ENV, { ...ZERO, platformDay: l.perPlatformPerDay }, NOW, CAPS)).toMatchObject({ reason: "limit" });
    expect(sendGate(row(), LIVE, ENV, { ...ZERO, globalDay: l.globalPerDay }, NOW, CAPS)).toMatchObject({ reason: "limit" });
  });
  it("7. a second auto reply to the same person in the window → limit (per-person); manual and hide are exempt", () => {
    const c = { ...ZERO, authorWindow: 1 };
    expect(sendGate(row(), LIVE, ENV, c, NOW, CAPS)).toEqual({ ok: false, reason: "limit", detail: "per-person" });
    expect(sendGate(row({ origin: "manual" }), LIVE, ENV, c, NOW, CAPS)).toEqual({ ok: true });
    expect(sendGate(row({ kind: "hide", text: null }), LIVE, ENV, c, NOW, CAPS)).toEqual({ ok: true });
  });
  it("8. missing capability → no-capability (only when src is given)", () => {
    expect(sendGate(row(), LIVE, ENV, ZERO, NOW, { canReply: false, canHide: true })).toMatchObject({ reason: "no-capability" });
    expect(sendGate(row({ kind: "hide", text: null }), LIVE, ENV, ZERO, NOW, { canReply: true, canHide: false })).toMatchObject({ reason: "no-capability" });
    expect(sendGate(row(), LIVE, ENV, ZERO, NOW)).toEqual({ ok: true });
  });
  it("manual actions skip the mode check but not killed or limits", () => {
    const manual = row({ origin: "manual" });
    expect(sendGate(manual, DEFAULT_ENGAGEMENT, ENV, ZERO, NOW, CAPS)).toEqual({ ok: true });
    expect(sendGate(manual, { ...DEFAULT_ENGAGEMENT, killed: true }, ENV, ZERO, NOW, CAPS)).toMatchObject({ reason: "killed" });
    expect(sendGate(manual, DEFAULT_ENGAGEMENT, ENV, { ...ZERO, platformHour: 10 }, NOW, CAPS)).toMatchObject({ reason: "limit" });
    expect(sendGate(row({ origin: "manual", kind: "hide", text: null }), DEFAULT_ENGAGEMENT, ENV, ZERO, NOW, CAPS)).toMatchObject({ reason: "mode", detail: "hide disabled" });
  });
});
