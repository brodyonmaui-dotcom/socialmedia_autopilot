// Pure view logic for /platforms/[platform]. No DB, no React. Tested in __tests__/view.test.ts.
import { addCalendarDays, CAPABILITIES, PLATFORMS, weekdayIndex, type Platform } from "@autopilot/core";
import type { EngagementSettings, Mode } from "@autopilot/engagement";
import type { Entry } from "../calendar/model.js";

export const PLATFORM_NAME: Record<Platform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", snapchat: "Snapchat" };

/** The route segment → a platform, or null (the page 404s). Case-sensitive: the sidebar links are lower case. */
export function parsePlatform(slug: unknown): Platform | null {
  return typeof slug === "string" && (PLATFORMS as readonly string[]).includes(slug) ? (slug as Platform) : null;
}

/**
 * One sentence on how posts go out, from the capability matrix (route + who holds the clock).
 * Plain words: no API names beyond the platform's own.
 */
export function routeSentence(p: Platform): string {
  const c = CAPABILITIES[p];
  const name = PLATFORM_NAME[p];
  if (c.route === "assisted") return `You post to ${name} yourself: the app gets the clip ready and opens the share sheet, one Spotlight a day.`;
  if (c.route === "middleman") return `Posts go to ${name} through Zernio, an approved partner, which holds the schedule. Posts that need a ${name} sound arrive in your ${name} inbox as drafts.`;
  if (c.scheduling === "native") return `Each post uploads to ${name} as private with its time set, and ${name} makes it public on schedule.`;
  return `The app posts to ${name} through its official API at each scheduled time.`;
}

/** Short route word for the status list. */
export function routeWord(p: Platform): string {
  const r = CAPABILITIES[p].route;
  return r === "assisted" ? "You share by hand" : r === "middleman" ? "Through Zernio" : "Direct";
}

/** Which token-health service covers a platform (alerts.platform of kind 'token-health'). */
export function tokenService(p: Platform): "meta" | "youtube" | "zernio" | null {
  return p === "instagram" ? "meta" : p === "youtube" ? "youtube" : p === "tiktok" ? "zernio" : null;
}

export type Tone = "neutral" | "accent" | "warn" | "danger";

export interface TokenAlert {
  message: string;
  createdAt: string;
}

/** Connection row: from the newest open token-health alert for the platform's service. */
export function connectionView(p: Platform, alert: TokenAlert | null): { label: string; tone: Tone; detail: string } {
  if (tokenService(p) === null) return { label: "Not needed", tone: "neutral", detail: "No account is connected: you share from your phone." };
  if (!alert) return { label: "No problems", tone: "neutral", detail: "The daily login check has nothing open for this account." };
  const m = /^(warn|fail):\s*(.*)$/s.exec(alert.message.trim());
  const level = m?.[1] ?? "warn";
  const text = (m?.[2] ?? alert.message).trim().slice(0, 160);
  return level === "fail"
    ? { label: "Login needs renewing", tone: "danger", detail: text || "The daily login check failed. See the token-renewal runbook." }
    : { label: "Login expires soon", tone: "warn", detail: text || "The daily login check raised a warning. See the token-renewal runbook." };
}

/** Today's posts vs the daily cap. `sent` counts like the outbox does (published, publishing, unknown). */
export interface TodayCounts {
  sent: number;
  planned: number;
}

export function todayView(c: TodayCounts, cap: number): { value: string; note: string; full: boolean } {
  const sent = Math.max(0, c.sent);
  const planned = Math.max(0, c.planned);
  const value = `${sent} of ${cap}`;
  if (cap === 0) return { value, note: "Posting is off: the daily limit is 0", full: true };
  if (sent >= cap) return { value, note: "Daily limit reached", full: true };
  return { value, note: planned === 0 ? "Nothing else planned today" : planned === 1 ? "1 more planned today" : `${planned} more planned today`, full: false };
}

const MODE_WORD: Record<Mode, string> = { off: "Off", shadow: "Drafts only", live: "Auto" };

/** Reply mode for a platform; Snapchat has none. "Paused" when the kill switch (setting or env) is on and the mode is Auto. */
export function replyView(p: Platform, s: Pick<EngagementSettings, "mode" | "killed">, killEnv = false): { label: string; tone: Tone; detail: string } {
  if (p === "snapchat") return { label: "None", tone: "neutral", detail: "Snapchat has no comment API, so the app never sees or answers replies there." };
  const m = s.mode[p];
  if (m === "live" && (s.killed || killEnv)) return { label: "Paused", tone: "warn", detail: "Auto replies are paused for every platform. Turn them back on in Settings." };
  if (m === "live") return { label: MODE_WORD[m], tone: "accent", detail: "Routine replies go out on their own after the veto window." };
  if (m === "shadow") return { label: MODE_WORD[m], tone: "neutral", detail: "Replies are drafted for you; nothing goes out unless you send it." };
  return { label: MODE_WORD[m], tone: "neutral", detail: "Comments are collected but no replies are drafted." };
}

export interface UpcomingRow {
  key: string;
  itemId: string;
  mediaId: string;
  title: string;
  /** "Wed, Nov 18 · 10:38" */
  when: string;
  day: string;
  statusLabel: string;
  tone: Tone;
  href: string;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Today", "Tomorrow" or "Wed, Nov 18". */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addCalendarDays(today, 1)) return "Tomorrow";
  return `${WD[weekdayIndex(day)]}, ${MON[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
}

/**
 * The next `limit` posts for one platform: calendar entries' items on that platform, scheduled after `now`,
 * not rejected, soonest first. Each links to its calendar day.
 */
export function upcomingFor(entries: readonly Entry[], p: Platform, now: Date, today: string, limit = 5): UpcomingRow[] {
  const rows: Array<UpcomingRow & { at: number }> = [];
  for (const e of entries) {
    if (!e.day) continue;
    for (const it of e.platforms) {
      if (it.platform !== p || !it.scheduledFor || it.status === "rejected" || it.status === "published") continue;
      const at = Date.parse(it.scheduledFor);
      if (!(at > now.getTime())) continue;
      rows.push({
        key: `${e.key}|${it.itemId}`,
        itemId: it.itemId,
        mediaId: e.mediaId,
        title: e.title,
        when: it.time ? `${dayLabel(e.day, today)} · ${it.time}` : dayLabel(e.day, today),
        day: e.day,
        statusLabel: it.statusLabel,
        tone: it.tone,
        href: `/calendar?day=${e.day}`,
        at,
      });
    }
  }
  return rows
    .sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map(({ at: _at, ...r }) => r);
}

/** "12,400" / "4.2%" / null-safe numbers for the analytics tiles. */
export const fmtCount = (n: number | null | undefined): string | null => (n == null || !Number.isFinite(n) ? null : Math.round(n).toLocaleString("en-US"));
export const fmtRate = (r: number | null | undefined): string | null => (r == null || !Number.isFinite(r) ? null : `${(r * 100).toFixed(1)}%`);

/** Signed follower change for a tile note: "+120 in 30 days", "No change in 30 days", null when unknown. */
export function followerNote(delta: number | null | undefined, days: number): string | null {
  if (delta == null || !Number.isFinite(delta)) return null;
  if (delta === 0) return `No change in ${days} days`;
  return `${delta > 0 ? "+" : "−"}${Math.abs(Math.round(delta)).toLocaleString("en-US")} in ${days} days`;
}
