// Pure view logic for the Snapchat handoff (now on /platforms/snapchat). No DB, no React. Tested in __tests__/view.test.ts.
import type { ActionResult } from "./types.js";

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

/** "18 s" or null. */
export const durationLabel = (s: number | undefined): string | null => (s == null ? null : `${Math.round(s)} s`);

/**
 * Visible label for the share button. The state machine (share-machine.ts) owns the action and the
 * enabled flag; this only renames: tap 1 "Share to Snapchat" (downloads the clip), tap 2 "Share to Snapchat · 2.5 MB"
 * (opens the share sheet inside a fresh tap, which iOS requires). The hint under the button says which tap is next.
 */
export function shareLabel(machineLabel: string): string {
  if (machineLabel === "Prepare") return "Share to Snapchat";
  if (machineLabel === "Prepare again") return "Try again";
  if (machineLabel === "Share (blocked)") return "Share blocked";
  const mb = /^Share \(([\d.]+) MB\)$/.exec(machineLabel);
  if (mb) return `Share to Snapchat · ${mb[1]} MB`;
  return machineLabel;
}

const NAME = { instagram: "Instagram", tiktok: "TikTok" } as const;

/** Read-only suggestion row (nothing due): "2.4× the TikTok median · 12,400 views". */
export function suggestionMeta(pick: { platform: keyof typeof NAME; score: number; views: number }): string {
  return `${pick.score.toFixed(1)}× the ${NAME[pick.platform]} median · ${pick.views.toLocaleString("en")} views`;
}

/** One line under the share button: what the next tap does. */
export function shareHint(s: { kind: string; sizeMb?: string }): string | null {
  if (s.kind === "idle") return "Two taps: the first gets the clip ready, the second opens the share sheet.";
  if (s.kind === "preparing") return "Getting the clip ready…";
  if (s.kind === "ready") return `Ready (${s.sizeMb} MB). Tap again to open the share sheet.`;
  if (s.kind === "shared") return "Sent to the share sheet. Mark it posted once it's up.";
  return null;
}
