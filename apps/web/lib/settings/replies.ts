// Pure view + validation for the Settings page's Replies, Research and notice rows. No DB, no React.
// Tested in __tests__/replies.test.ts. The writes reuse lib/engagement/settings.ts and lib/inbox/*.
import type { EngagementPlatform, Mode, PingMode } from "@autopilot/engagement";
import { resumeOk } from "../inbox/view.js";

export const REPLY_PLATFORMS: readonly EngagementPlatform[] = ["instagram", "youtube", "tiktok"];
export const MODES: readonly Mode[] = ["off", "shadow", "live"];
export const MODE_LABEL: Record<Mode, string> = { off: "Off", shadow: "Drafts only", live: "Auto" };
export const PINGS: readonly PingMode[] = ["each", "hourly", "off"];
export const PING_LABEL: Record<PingMode, string> = { each: "Each one", hourly: "Hourly", off: "Off" };

/** The word typed to switch a platform to Auto (checked again on the server). */
export const AUTO_WORD = "auto";
export const autoOk = (word: string) => word.trim().toLowerCase() === AUTO_WORD;
export { resumeOk };

export type ModeChange = { ok: true; platform: EngagementPlatform; mode: Mode } | { ok: false; error: string };

/**
 * Validates a mode change from the Settings form. Going to Auto ("live") needs the word typed in the
 * dialog: a stricter copy of the inbox's confirm Sheet (the worker's DRY_RUN + --live gate still applies).
 */
export function parseModeChange(platform: unknown, mode: unknown, confirm: unknown): ModeChange {
  if (typeof platform !== "string" || !(REPLY_PLATFORMS as readonly string[]).includes(platform)) return { ok: false, error: "unknown platform" };
  if (typeof mode !== "string" || !(MODES as readonly string[]).includes(mode)) return { ok: false, error: "unknown mode" };
  if (mode === "live" && !autoOk(typeof confirm === "string" ? confirm : "")) return { ok: false, error: `type "${AUTO_WORD}" to turn on auto replies` };
  return { ok: true, platform: platform as EngagementPlatform, mode: mode as Mode };
}

/** "Off · needs your OK in chat · 12,400 tokens used this month" (or "On · …" once enabled on the server). */
export function aiNotesLine(a: { on: boolean; tokensUsedThisMonth: number }): string {
  const used = `${Math.max(0, Math.round(a.tokensUsedThisMonth)).toLocaleString("en-US")} ${a.tokensUsedThisMonth === 1 ? "token" : "tokens"} used this month`;
  return a.on ? `On · ${used}` : `Off · needs your OK in chat · ${used}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 18" in the given zone (UTC when the creator zone isn't set). */
export function shortDate(isoAt: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric", day: "numeric" }).formatToParts(new Date(isoAt));
  const m = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${MON[m - 1]} ${d}`;
}

/** Last research run in plain words. */
export function lastRunLine(run: { startedAt: string; finishedAt: string | null; status: string; ideasAdded: number; hooksAdded: number } | null, timeZone: string): string {
  if (!run) return "Hasn't run yet";
  const when = shortDate(run.finishedAt ?? run.startedAt, timeZone);
  if (run.status === "running") return `Running since ${when}`;
  if (run.status === "failed") return `${when} · didn't finish`;
  const ideas = `${run.ideasAdded} ${run.ideasAdded === 1 ? "idea" : "ideas"}`;
  const hooks = `${run.hooksAdded} ${run.hooksAdded === 1 ? "hook" : "hooks"}`;
  return `${when} · ${ideas} and ${hooks} added`;
}

/** The time-zone notice (only when TZ_CREATOR isn't set or is invalid). */
export function zoneNotice(source: "env" | "fallback"): string | null {
  return source === "env"
    ? null
    : "Your time zone isn't set, so days are counted in UTC and the Snapchat page waits. It's set on the server; see the Snapchat handoff runbook.";
}

/** Copy for the pause-all (kill switch) dialog. `paused` is the current state; the dialog proposes the opposite. */
export function pauseCopy(paused: boolean): { title: string; points: string[]; confirm: string } {
  if (!paused) {
    return {
      title: "Pause all replies?",
      points: [
        "Stops every auto reply and hide on all platforms at once, including sends from the inbox.",
        "Planned replies are held, not deleted. They go out after you resume.",
      ],
      confirm: "Pause replies",
    };
  }
  return {
    title: "Resume replies?",
    points: [
      "Each platform goes back to its own mode: drafts stay drafts, Auto sends.",
      "Replies held while paused go out on the next worker tick.",
      "A pause set on the server still wins.",
    ],
    confirm: "Resume",
  };
}
