import type { Metrics } from "./types.js";

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** (likes + comments + saves + shares) / views, over the interactions the platform reported. */
export function engagementRate(m: Metrics): number | null {
  const parts = [m.likes, m.comments, m.saves, m.shares].filter((x): x is number => x !== null);
  if (!parts.length || !m.views) return null;
  return parts.reduce((a, b) => a + b, 0) / m.views;
}

export type LengthBucket = "<15s" | "15–30s" | "30–60s" | ">60s" | "unknown";
export function lengthBucket(durationS: number | null): LengthBucket {
  if (durationS === null || !Number.isFinite(durationS)) return "unknown";
  if (durationS < 15) return "<15s";
  if (durationS < 30) return "15–30s";
  if (durationS <= 60) return "30–60s";
  return ">60s";
}

export type TimeBucket = "morning" | "midday" | "afternoon" | "evening" | "late";
/** Local hour in the creator's zone. The zone comes from TZ_CREATOR at runtime and is never printed. */
export function localHour(iso: string, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).format(new Date(iso));
  return Number(h) % 24;
}
export function timeBucket(hour: number): TimeBucket {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 14) return "midday";
  if (hour >= 14 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "late";
}

export const fmtInt = (n: number | null) => (n === null ? "n/a" : Math.round(n).toLocaleString("en-US"));
export const fmtPct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
export const fmtX = (x: number | null) => (x === null ? "n/a" : `×${x.toFixed(2)}`);
