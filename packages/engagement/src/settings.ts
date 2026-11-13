import { NEGATIVE_POOL, POSITIVE_POOL } from "./pools.js";
import type { EngagementLimits, EngagementPlatform, EngagementSettings, Mode } from "./types.js";

const PLATFORMS: readonly EngagementPlatform[] = ["instagram", "youtube", "tiktok"];
const MODES: readonly Mode[] = ["off", "shadow", "live"];

/** Decisions (run-2-decisions.md F3): everything ships in shadow, TikTok comments out, hide off, 10/h 40/d 80/d, 10-min veto. */
export const DEFAULT_ENGAGEMENT: EngagementSettings = {
  mode: { instagram: "shadow", youtube: "shadow", tiktok: "off" },
  killed: false,
  hideEnabled: { instagram: false, youtube: false, tiktok: false },
  limits: { perPersonDays: 7, perPlatformPerHour: 10, perPlatformPerDay: 40, globalPerDay: 80 },
  minDelayMin: 10,
  pollMinutes: { instagram: 5, youtube: 15 },
  pools: { positive: [...POSITIVE_POOL], negative: [...NEGATIVE_POOL] },
  dmPollVerified: false,
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, v) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const pool = (v: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(v) || v.length === 0 || !v.every((s) => typeof s === "string")) return [...fallback];
  const lines = (v as string[]).map((s) => s.trim()).filter(Boolean);
  return lines.length ? lines : [...fallback];
};

/**
 * Deep-merges a partial JSON overlay (settings row 'engagement') onto `base`. Unknown keys are
 * ignored, invalid values fall back to base, limits clamp to ≥0, delays/poll intervals to ≥1.
 * Always returns a fresh object (base is never shared or mutated).
 */
export function normalizeEngagement(input: unknown, base: EngagementSettings = DEFAULT_ENGAGEMENT): EngagementSettings {
  const o: Obj = isObj(input) ? input : {};
  const mode = isObj(o.mode) ? o.mode : {};
  const hide = isObj(o.hideEnabled) ? o.hideEnabled : {};
  const limits = isObj(o.limits) ? o.limits : {};
  const poll = isObj(o.pollMinutes) ? o.pollMinutes : {};
  const pools = isObj(o.pools) ? o.pools : {};

  const outMode = {} as Record<EngagementPlatform, Mode>;
  const outHide = {} as Record<EngagementPlatform, boolean>;
  for (const p of PLATFORMS) {
    const m = mode[p];
    outMode[p] = typeof m === "string" && (MODES as readonly string[]).includes(m) ? (m as Mode) : base.mode[p];
    outHide[p] = bool(hide[p], base.hideEnabled[p]);
  }
  const outLimits: EngagementLimits = {
    perPersonDays: num(limits.perPersonDays, base.limits.perPersonDays, 0),
    perPlatformPerHour: num(limits.perPlatformPerHour, base.limits.perPlatformPerHour, 0),
    perPlatformPerDay: num(limits.perPlatformPerDay, base.limits.perPlatformPerDay, 0),
    globalPerDay: num(limits.globalPerDay, base.limits.globalPerDay, 0),
  };

  const out: EngagementSettings = {
    mode: outMode,
    killed: bool(o.killed, base.killed),
    hideEnabled: outHide,
    limits: outLimits,
    minDelayMin: num(o.minDelayMin, base.minDelayMin, 1),
    pollMinutes: {
      instagram: num(poll.instagram, base.pollMinutes.instagram, 1),
      youtube: num(poll.youtube, base.pollMinutes.youtube, 1),
    },
    pools: { positive: pool(pools.positive, base.pools.positive), negative: pool(pools.negative, base.pools.negative) },
    dmPollVerified: bool(o.dmPollVerified, base.dmPollVerified),
  };
  const reason = typeof o.killedReason === "string" ? o.killedReason : base.killedReason;
  if (reason !== undefined) out.killedReason = reason;
  return out;
}
