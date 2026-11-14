import type { ActionStatus, Bucket, EngagementLimits, EngagementPlatform, EngagementSettings, Mode } from "@autopilot/engagement";

/** Pure view logic for /inbox and /inbox/dms (labels, tones, counts). No I/O. */

type Line = { text: string; style: "solid" | "stroke" | "serif" };
type Tone = "neutral" | "accent" | "warn" | "danger";
export type CommentTab = "flagged" | "shadow" | "sent";
export type InboxCounts = { flagged: number; shadow: number; dmsOpen: number };

export const ENGAGEMENT_PLATFORMS: readonly EngagementPlatform[] = ["instagram", "youtube", "tiktok"];
export const PLATFORM_NAME: Record<EngagementPlatform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok" };

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const two = (n: number) => String(Math.max(0, n)).padStart(2, "0");

/** What needs the creator: unhandled flagged comments + DM threads still inside the 24 h window. */
export function needsYou(c: InboxCounts): number {
  return Math.max(0, c.flagged) + Math.max(0, c.dmsOpen);
}

export function heroLines(c: InboxCounts): Line[] {
  return [
    { text: "Inbox", style: "stroke" },
    { text: "needs you", style: "serif" },
    { text: two(needsYou(c)), style: "solid" },
  ];
}

/** Top-level Comments / DMs tabs (URL tabs; the comment sub-tab keeps its ?tab= param). */
export function primaryTabs(onDms: boolean, c: InboxCounts) {
  return [
    { href: "/inbox", label: "Comments", count: c.flagged, active: !onDms },
    { href: "/inbox/dms", label: "DMs", count: c.dmsOpen, active: onDms },
  ];
}

export function commentTabs(current: CommentTab, c: InboxCounts) {
  return [
    { href: "/inbox", label: "Flagged", count: c.flagged, active: current === "flagged" },
    { href: "/inbox?tab=shadow", label: "Shadow", count: c.shadow, active: current === "shadow" },
    { href: "/inbox?tab=sent", label: "Sent", active: current === "sent" },
  ];
}

const BUCKET: Record<Bucket, { label: string; tone: Tone }> = {
  flag: { label: "Flag", tone: "warn" },
  hide_flag: { label: "Hide + flag", tone: "danger" },
  negative: { label: "Negative", tone: "warn" },
  simple_positive: { label: "Positive", tone: "neutral" },
};

/** Triage label as a Chip (no green: positive is neutral; warn/danger carry the alert icon). */
export function bucketChip(bucket: string | null | undefined): { label: string; tone: Tone } | null {
  if (!bucket) return null;
  return BUCKET[bucket as Bucket] ?? { label: bucket.replace(/_/g, " "), tone: "neutral" };
}

const STATUS: Partial<Record<ActionStatus, { label: string; tone: "neutral" | "accent" | "warn" | "danger" }>> = {
  sent: { label: "Sent", tone: "accent" },
  sending: { label: "Sending", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
  unknown: { label: "Unknown", tone: "warn" },
  shadow: { label: "Shadow", tone: "neutral" },
  planned: { label: "Planned", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function actionBadge(status: string | undefined): { label: string; tone: "neutral" | "accent" | "warn" | "danger" } | null {
  if (!status) return null;
  return STATUS[status as ActionStatus] ?? { label: status, tone: "neutral" };
}

/** Label over the reply well. */
export function replyLabel(tab: CommentTab): string {
  return tab === "shadow" ? "Would reply" : tab === "sent" ? "Reply" : "Draft reply";
}

export function emptyCopy(tab: CommentTab): { title: string; body: string } {
  if (tab === "shadow") return { title: "No shadow replies", body: "In shadow mode the worker stores what it would have said here. Nothing is sent." };
  if (tab === "sent") return { title: "Nothing sent yet", body: "Replies and hides the worker sent show up here, newest first." };
  return { title: "Nothing flagged", body: "Comments that need you show up here." };
}

/** Overall auto-reply state for the hero pulse. Killed wins; then any live platform; else shadow/off. */
export function enginePulse(s: Pick<EngagementSettings, "killed" | "mode">): { label: string; tone: "accent" | "danger" | "muted" } {
  if (s.killed) return { label: "Auto-replies killed", tone: "danger" };
  const live = ENGAGEMENT_PLATFORMS.filter((p) => s.mode[p] === "live");
  if (live.length > 0) return { label: `Live · ${live.map((p) => PLATFORM_NAME[p]).join(", ")}`, tone: "accent" };
  if (ENGAGEMENT_PLATFORMS.some((p) => s.mode[p] === "shadow")) return { label: "Shadow · nothing sent", tone: "muted" };
  return { label: "Auto-replies off", tone: "muted" };
}

/** Per-platform mode pulse: live is blue (never green); shadow/off muted. Killed overrides live. */
export function modePulse(mode: Mode, killed: boolean): { label: string; tone: "accent" | "danger" | "muted" } {
  if (mode === "live") return killed ? { label: "Live · held", tone: "danger" } : { label: "Live", tone: "accent" };
  return { label: mode === "shadow" ? "Shadow" : "Off", tone: "muted" };
}

export type SentLike = { platform: EngagementPlatform; actionStatus?: string | undefined; sentAt?: string | null | undefined };

/**
 * Sends in the last 24 h (sent + sending, like the worker's countSent), per platform and overall.
 * `rows` is the Sent tab list (newest first, capped at 100, which is above the 80/day global limit).
 */
export function sentLast24h(rows: readonly SentLike[], now: Date): { all: number } & Record<EngagementPlatform, number> {
  const since = now.getTime() - 24 * 3_600_000;
  const out = { all: 0, instagram: 0, youtube: 0, tiktok: 0 };
  for (const r of rows) {
    if (r.actionStatus !== "sent" && r.actionStatus !== "sending") continue;
    if (r.actionStatus === "sent") {
      const t = r.sentAt ? Date.parse(r.sentAt) : NaN;
      if (!Number.isFinite(t) || t < since) continue;
    }
    out.all++;
    if (r.platform in out) out[r.platform]++;
  }
  return out;
}

/** Limit readouts: "used/limit" plus what's left, overall and per platform, then the fixed caps. */
export function limitReadout(limits: EngagementLimits, used: ReturnType<typeof sentLast24h>, minDelayMin: number) {
  const left = (u: number, max: number) => Math.max(0, max - u);
  return [
    { k: "All · 24 h", v: `${used.all}/${limits.globalPerDay} · ${left(used.all, limits.globalPerDay)} left` },
    ...ENGAGEMENT_PLATFORMS.map((p) => ({ k: `${PLATFORM_NAME[p]} · 24 h`, v: `${used[p]}/${limits.perPlatformPerDay} · ${left(used[p], limits.perPlatformPerDay)} left` })),
    { k: "Per hour", v: `${limits.perPlatformPerHour} / platform` },
    { k: "Per person", v: `1 / ${limits.perPersonDays} days` },
    { k: "Veto window", v: `${minDelayMin} min` },
  ];
}

/** Copy for the kill-switch sheet. `killed` is the current state; the sheet proposes the opposite. */
export function killSheet(killed: boolean): { title: string; points: string[]; confirm: string } {
  if (!killed) {
    return {
      title: "Kill auto-replies?",
      points: [
        "Stops every auto-reply and hide on all platforms at once, including manual sends from this inbox.",
        "Planned replies are held, not deleted. They send after you turn the switch off again.",
        "Writes an engagement-kill alert. Shadow rows keep being stored.",
      ],
      confirm: "Kill auto-replies",
    };
  }
  return {
    title: "Turn auto-replies back on?",
    points: [
      "Each platform goes back to its own mode: shadow stores only, live sends.",
      "Replies held while killed send on the next worker tick. Delete stale ones first.",
      "For a platform block, wait 24–48 h in shadow before resuming. ENGAGEMENT_KILL in the server env still wins.",
    ],
    confirm: "Resume",
  };
}

/** Resume needs the word typed (the server checks it again). */
export const resumeOk = (word: string) => word.trim().toLowerCase() === "resume";

/** DM reply-window tone for the countdown text. */
export function dmWindowTone(w: { open: boolean; msLeft: number }): "accent" | "warn" | "muted" {
  if (!w.open || w.msLeft <= 0) return "muted";
  return w.msLeft < 3 * 3_600_000 ? "warn" : "accent";
}

/** The last three messages of a thread, labelled for the transcript. */
export function lastMessages<M extends { dir: "in" | "out" }>(messages: readonly M[], n = 3): Array<M & { who: "Them" | "You" }> {
  return messages.slice(-n).map((m) => ({ ...m, who: m.dir === "in" ? "Them" : "You" }));
}

export const handleLabel = (h: string | null | undefined, fallback = "unknown author") => (h ? `@${h}` : fallback);
