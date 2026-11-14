// Pure view logic for the Home dashboard (app/page.tsx). No DB, no React. Tested in __tests__/view.test.ts.
import { localDate, localHHMM, localParts, type Platform, type PlatformCapability } from "@autopilot/core";

export type ItemStatus = "draft" | "approved" | "queued" | "publishing" | "published" | "failed" | "unknown" | "rejected";
type Line = { text: string; style?: "solid" | "stroke" | "serif" };

const pad2 = (n: number) => String(n).padStart(2, "0");

/** ISO-8601 week number of a "YYYY-MM-DD" calendar date. */
export function isoWeek(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7; // Mon=1 … Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - dow); // Thursday of this week decides the year
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

export interface BatchProgress {
  /** Approved or further along (queued, publishing, published). */
  approved: number;
  /** Everything except rejected. */
  total: number;
  draft: number;
  published: number;
  /** failed + unknown: need a look. */
  attention: number;
}

export function batchProgress(counts: Partial<Record<ItemStatus, number>>): BatchProgress {
  const c = (s: ItemStatus) => counts[s] ?? 0;
  const approved = c("approved") + c("queued") + c("publishing") + c("published");
  const attention = c("failed") + c("unknown");
  return { approved, total: approved + c("draft") + attention, draft: c("draft"), published: c("published"), attention };
}

export interface LatestBatch {
  id: string;
  weekStart: string;
  status: string;
  counts: Partial<Record<ItemStatus, number>>;
}

/** Hero display lines: "Week 47 / approved / 18/24", or "Nothing / drafted / yet" with no batch. */
export function heroLines(batch: LatestBatch | null): Line[] {
  if (!batch) return [{ text: "Nothing", style: "stroke" }, { text: "drafted", style: "serif" }, { text: "yet" }];
  const p = batchProgress(batch.counts);
  return [
    { text: `Week ${isoWeek(batch.weekStart)}`, style: "stroke" },
    { text: batch.status === "approved" ? "approved" : "in draft", style: "serif" },
    { text: `${p.approved}/${p.total}` },
  ];
}

const FORMAT: Record<Platform, string> = {
  instagram: "REEL",
  youtube: "SHORT",
  tiktok: "VIDEO",
  snapchat: "SPOTLIGHT · TAP TO SHARE",
};
export const PLATFORM_SHORT: Record<Platform, string> = { instagram: "IG", youtube: "YT", tiktok: "TT", snapchat: "SC" };

/** "0:42" from seconds; "" when unknown. */
export function clipLength(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(Number(s))) return "";
  const t = Math.round(Number(s));
  return `${Math.floor(t / 60)}:${pad2(t % 60)}`;
}

/** "MON 16 NOV" + "09:00" for an instant, creator-local; UTC (labelled) when TZ_CREATOR is unset. */
export function whenParts(at: Date, timeZone: string | null): { day: string; time: string } {
  const tz = timeZone ?? "UTC";
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" })
    .format(at)
    .replace(",", "")
    .toUpperCase();
  return { day, time: `${localHHMM(at, tz)}${timeZone ? "" : " UTC"}` };
}

export interface UpNextRow {
  id: string;
  batchId: string;
  platform: Platform;
  title: string | null;
  caption: string | null;
  scheduledFor: Date;
  durationS: number | null;
}

/** A short display title: the YouTube title, else the caption's first words (no tags, mentions or links). */
export function upNextTitle(title: string | null, caption: string | null, max = 28): string {
  const pick = (title ?? "").trim() || (caption ?? "").split("\n")[0]!;
  const clean = pick
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#@][\p{L}\p{N}_.]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "Untitled clip";
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max / 2 ? cut.slice(0, sp) : clean.slice(0, max)).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** "MON 16 NOV · 09:00 · REEL · 0:42". */
export function upNextMeta(r: Pick<UpNextRow, "platform" | "scheduledFor" | "durationS">, timeZone: string | null): string {
  const w = whenParts(r.scheduledFor, timeZone);
  return [w.day, w.time, FORMAT[r.platform], clipLength(r.durationS)].filter(Boolean).join(" · ");
}

/** "09:00 · IG" for the hero readout; "—" when nothing is scheduled. */
export function nextPostShort(r: Pick<UpNextRow, "platform" | "scheduledFor"> | undefined, timeZone: string | null): string {
  if (!r) return "—";
  return `${whenParts(r.scheduledFor, timeZone).time} · ${PLATFORM_SHORT[r.platform]}`;
}

export type DayMark = "accent" | "warn" | "muted";

/** Calendar mark for an item status: scheduled = accent, failed/unknown = warn, published = muted; drafts/rejected none. */
export function markFor(status: string): DayMark | null {
  if (status === "approved" || status === "queued" || status === "publishing") return "accent";
  if (status === "failed" || status === "unknown") return "warn";
  if (status === "published") return "muted";
  return null;
}

/** This creator-local month and its marks (max 3 per day, warn first so it isn't hidden). */
export function monthMarks(
  rows: Array<{ scheduledFor: Date; status: string }>,
  now: Date,
  timeZone: string | null,
): { year: number; month0: number; today: number; marks: Record<number, DayMark[]> } {
  const tz = timeZone ?? "UTC";
  const n = localParts(now, tz);
  const prefix = `${n.year}-${pad2(n.month)}-`;
  const marks: Record<number, DayMark[]> = {};
  for (const r of rows) {
    const m = markFor(r.status);
    const ymd = localDate(r.scheduledFor, tz);
    if (!m || !ymd.startsWith(prefix)) continue;
    (marks[Number(ymd.slice(8))] ??= []).push(m);
  }
  const order: Record<DayMark, number> = { warn: 0, accent: 1, muted: 2 };
  for (const k of Object.keys(marks)) marks[Number(k)] = marks[Number(k)]!.sort((a, b) => order[a] - order[b]).slice(0, 3);
  return { year: n.year, month0: n.month - 1, today: n.day, marks };
}

/** "DIRECT · SERVER FIRES" etc. for a capability route. */
export function routeLabel(cap: Pick<PlatformCapability, "route" | "scheduling">): string {
  const sched: Record<string, string> = { "server-fires": "server fires", native: "platform clock", none: "tap to share" };
  return `${cap.route} · ${sched[cap.scheduling] ?? cap.scheduling}`.toUpperCase();
}

/** Snapchat-today line: null zone → the explicit "TZ_CREATOR not set" (never guess "today"). */
export function snapLine(snapToday: number | null): string {
  if (snapToday === null) return "TZ_CREATOR not set";
  return snapToday === 1 ? "1 to share today" : `${snapToday} to share today`;
}

/** Marquee words from the platforms + the batch week (real data only). */
export function marqueeItems(platforms: Platform[], batch: LatestBatch | null): Line[] {
  const NAME: Record<Platform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", snapchat: "Snapchat" };
  const out: Line[] = platforms.map((p, i) => ({ text: NAME[p], style: i % 2 ? "serif" : "stroke" }));
  if (batch) out.push({ text: `Week ${isoWeek(batch.weekStart)}`, style: "stroke" }, { text: batch.status === "approved" ? "approved" : "in draft", style: "serif" });
  return out;
}

/** Plural helper for "1 post" / "2 posts". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
