// Pure view logic for the Snapchat handoff page (app/handoff). No DB, no React. Tested in __tests__/view.test.ts.
import type { ActionResult, HandoffItem } from "./types.js";

type Line = { text: string; style?: "solid" | "stroke" | "serif" };

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The privacy line (location / Snap Map) the creator must check on every share. */
export const isLocationLine = (line: string) => /location|snap map/i.test(line);

/** Checklist with the location / Snap Map line(s) first (the one rule that must never be missed); rest keep their order. */
export function orderedChecklist(lines: readonly string[]): Array<{ text: string; privacy: boolean }> {
  const tagged = lines.map((text) => ({ text, privacy: isLocationLine(text) }));
  return [...tagged.filter((l) => l.privacy), ...tagged.filter((l) => !l.privacy)];
}

/** Message after a Mark posted / Skip / Drop action. Stale-row failures collapse into one "reload" line. */
export function resultText(r: ActionResult, verb: string): string {
  if (r.ok) return r.to ? `${verb}: moved to ${r.to}.` : `${verb}.`;
  return /changed|reload|not found|0 rows/i.test(r.reason) ? "Changed underneath: reload." : r.reason.slice(0, 160);
}

/** Hero display: "Spotlight / shared today / 0/1". */
export function heroLines(shared: number): Line[] {
  return [
    { text: "Spotlight", style: "stroke" },
    { text: "shared today", style: "serif" },
    { text: `${Math.min(shared, 1)}/1`, style: "solid" },
  ];
}

/** 1-a-day progress: value is capped at 1 (a second share the same day would be a rule break, not progress). */
export function dailyProgress(shared: number): { value: number; max: 1; text: string } {
  const v = Math.max(0, Math.min(1, shared));
  return { value: v, max: 1, text: v >= 1 ? "1/1 done" : "0/1" };
}

/** Status dot above the hero: blue when something is due, warn when only missed items wait, muted when idle. */
export function pulseFor(today: number, missed: number, shared: number): { label: string; tone: "accent" | "warn" | "muted" } {
  if (today > 0) return { label: `${today} to share today`, tone: "accent" };
  if (missed > 0) return { label: `${plural(missed, "missed item")}`, tone: "warn" };
  if (shared > 0) return { label: "Shared today", tone: "accent" };
  return { label: "Nothing due", tone: "muted" };
}

/** Section meta for the Today head. */
export function todayMeta(items: readonly Pick<HandoffItem, "blocks">[]): string {
  const blocked = items.filter((i) => i.blocks.length > 0).length;
  return blocked > 0 ? `${items.length} due · ${blocked} blocked` : `${items.length} due · 1 per day`;
}

/** "18 s" or null. */
export const durationLabel = (s: number | undefined): string | null => (s == null ? null : `${Math.round(s)} s`);

/**
 * Visible label for the share button. The state machine (share-machine.ts) owns the action and the
 * enabled flag; this only renames: tap 1 "Prepare clip", tap 2 "Share to Snapchat · 2.5 MB".
 */
export function shareLabel(machineLabel: string): string {
  if (machineLabel === "Prepare") return "Prepare clip";
  if (machineLabel === "Prepare again") return "Prepare again";
  if (machineLabel === "Share (blocked)") return "Share blocked";
  const mb = /^Share \(([\d.]+) MB\)$/.exec(machineLabel);
  if (mb) return `Share to Snapchat · ${mb[1]} MB`;
  return machineLabel;
}

/** Step readout above the share button: 1 Prepare → 2 Share. */
export function shareStep(s: { kind: string; file?: unknown }): "1/2" | "2/2" {
  if (s.kind === "idle" || s.kind === "preparing" || s.kind === "blocked") return "1/2";
  return s.kind === "error" && !s.file ? "1/2" : "2/2";
}

const NAME = { instagram: "Instagram", tiktok: "TikTok" } as const;

/** Read-only suggestion row (nothing due): "2.4× the TikTok median · 12,400 views". */
export function suggestionMeta(pick: { platform: keyof typeof NAME; score: number; views: number }): string {
  return `${pick.score.toFixed(1)}× the ${NAME[pick.platform]} median · ${pick.views.toLocaleString("en")} views`;
}
