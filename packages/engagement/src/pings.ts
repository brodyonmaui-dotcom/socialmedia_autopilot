// Phone pings for the inbox (run 4): "X commented …, drafted reply …, approve?". Pure: the worker
// passes what it knows, gets back the alerts to write (kind 'reply-ready', pushed by the alert-push job).
// Pacing (settings engagement.pings): each = one ping per drafted/flagged item, hard cap 6 per hour then
// one digest; hourly (default) = one digest per hour while something new waits; off = nothing.
// A ping never carries a place: the whole message passes the caption privacy lint, else it says only
// "A comment needs you".
import { lintText } from "@autopilot/research";
import { isWhereabouts } from "./rules.js";
import type { EngagementPlatform, PingMode } from "./types.js";

export const PING_EACH_CAP_PER_HOUR = 6;
export const PING_DIGEST_EVERY_MS = 60 * 60_000;
export const PING_EXCERPT_CHARS = 60;
export const PING_GENERIC = "A comment needs you";

export interface PingItem {
  commentId: string;
  platform: EngagementPlatform;
  authorHandle: string | null;
  text: string;
  /** The drafted (shadow or planned) reply; null when the item is flagged. */
  draft: string | null;
  reasons: string[];
}

export interface PingState {
  /** 'reply-ready' alerts created in the last hour (items and digests). */
  sentLastHour: number;
  /** Newest 'reply-ready' alert of any kind, or null. */
  lastPingAt: Date | null;
  /** Newest digest, or null. */
  lastDigestAt: Date | null;
  /** Open items right now: drafted (shadow/planned reply, untouched) and flagged (needs you). */
  waiting: { drafted: number; flagged: number };
  /** Items decided after lastPingAt (or all open ones when there was none). */
  newSinceLastPing: number;
}

export type PlannedPing =
  | { kind: "item"; commentId: string; platform: EngagementPlatform; message: string }
  | { kind: "digest"; message: string };

const clip = (s: string, n = PING_EXCERPT_CHARS) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

/** True when nothing in `text` trips a privacy rule (places, coordinates, postcodes, addresses, blocklist). */
export function pingTextIsPrivate(text: string, blocklist: string[] = []): boolean {
  const lint = lintText({ text, kind: "caption", blocklist });
  return !lint.issues.some((i) => i.rule.startsWith("privacy."));
}

/** `<name> commented: "<60>". Drafted: "<60>". Approve?` or, for a flagged item, `… Needs you.` */
export function pingMessage(item: PingItem, blocklist: string[] = []): string {
  const unsafe =
    isWhereabouts(item.text) ||
    item.reasons.some((r) => /location|blocklist|hide|doxx|threat|phone/i.test(r)) ||
    (item.draft !== null && isWhereabouts(item.draft));
  if (unsafe) return PING_GENERIC;
  const name = item.authorHandle ? `@${item.authorHandle.replace(/^@+/, "")}` : "Someone";
  const msg =
    item.draft !== null
      ? `${name} commented: "${clip(item.text)}". Drafted: "${clip(item.draft)}". Approve?`
      : `${name} commented: "${clip(item.text)}". Needs you.`;
  return pingTextIsPrivate(msg, blocklist) ? msg : PING_GENERIC;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "5 replies drafted, 2 need you" (zero parts left out). */
export function digestMessage(waiting: { drafted: number; flagged: number }): string {
  const parts: string[] = [];
  if (waiting.drafted > 0) parts.push(`${plural(waiting.drafted, "reply", "replies")} drafted`);
  if (waiting.flagged > 0) parts.push(`${waiting.flagged} need${waiting.flagged === 1 ? "s" : ""} you`);
  return parts.length ? parts.join(", ") : PING_GENERIC;
}

/**
 * Which pings to write now. `items` are the drafted/flagged items new in this tick (each mode);
 * `state` is read from the alerts table. Never more than PING_EACH_CAP_PER_HOUR item pings per hour,
 * at most one digest per hour, nothing in "off" mode.
 */
export function planPings(mode: PingMode, items: readonly PingItem[], state: PingState, now: Date, blocklist: string[] = []): PlannedPing[] {
  if (mode === "off") return [];
  const hourSince = (d: Date | null) => d === null || now.getTime() - d.getTime() >= PING_DIGEST_EVERY_MS;
  const total = state.waiting.drafted + state.waiting.flagged;

  if (mode === "hourly") {
    if (total > 0 && state.newSinceLastPing > 0 && hourSince(state.lastPingAt)) return [{ kind: "digest", message: digestMessage(state.waiting) }];
    return [];
  }

  const room = Math.max(0, PING_EACH_CAP_PER_HOUR - state.sentLastHour);
  const out: PlannedPing[] = items.slice(0, room).map((i) => ({ kind: "item", commentId: i.commentId, platform: i.platform, message: pingMessage(i, blocklist) }));
  if (items.length > room && total > 0 && hourSince(state.lastDigestAt)) out.push({ kind: "digest", message: digestMessage(state.waiting) });
  return out;
}
