// Send gate (F3): pure, ordered checks before an engagement action may leave the building.
// Thread-dependent reasons (human-replied, already-exists, blocked-author) are decided by the send tick
// after a thread fetch, not here.

import type { EngagementActionRow, EngagementSettings, LimitCounts, SendGate } from "./types.js";

/**
 * First failing check wins, in this order:
 * dry-run → killed → mode (auto only) → hide disabled → too-early → platform/global limits →
 * per-person (auto replies) → capability (when `src` is given).
 */
export function sendGate(
  a: EngagementActionRow,
  s: EngagementSettings,
  env: { dryRun: boolean; killEnv: boolean },
  counts: LimitCounts,
  now: Date,
  src?: { canReply: boolean; canHide: boolean },
): SendGate {
  if (env.dryRun) return { ok: false, reason: "dry-run" };
  if (s.killed || env.killEnv) return { ok: false, reason: "killed", detail: s.killedReason ?? (env.killEnv ? "ENGAGEMENT_KILL" : undefined) };
  // Manual actions come from the inbox (the human pressed send), so only they skip the mode check.
  if (a.origin === "auto" && s.mode[a.platform] !== "live") return { ok: false, reason: "mode", detail: `${a.platform} is ${s.mode[a.platform]}` };
  if (a.kind === "hide" && !s.hideEnabled[a.platform]) return { ok: false, reason: "mode", detail: "hide disabled" };
  const notBefore = Date.parse(a.notBefore);
  if (Number.isFinite(notBefore) && now.getTime() < notBefore) return { ok: false, reason: "too-early", detail: `not before ${a.notBefore}` };
  const l = s.limits;
  if (counts.platformHour >= l.perPlatformPerHour) return { ok: false, reason: "limit", detail: `${a.platform} ${counts.platformHour}/${l.perPlatformPerHour} per hour` };
  if (counts.platformDay >= l.perPlatformPerDay) return { ok: false, reason: "limit", detail: `${a.platform} ${counts.platformDay}/${l.perPlatformPerDay} per day` };
  if (counts.globalDay >= l.globalPerDay) return { ok: false, reason: "limit", detail: `global ${counts.globalDay}/${l.globalPerDay} per day` };
  if (a.kind === "reply" && a.origin === "auto" && counts.authorWindow >= 1) return { ok: false, reason: "limit", detail: "per-person" };
  if (src) {
    if (a.kind === "reply" && !src.canReply) return { ok: false, reason: "no-capability", detail: `${a.platform} source cannot reply` };
    if (a.kind === "hide" && !src.canHide) return { ok: false, reason: "no-capability", detail: `${a.platform} source cannot hide` };
  }
  return { ok: true };
}
