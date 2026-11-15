import { addCalendarDays, localDate, localHHMM, PLATFORMS, type Platform } from "@autopilot/core";
import type { BatchItemView, Warning } from "../batches/types.js";
import { dayLabel } from "../batches/view-model.js";

/**
 * Pure view logic for the "From your editors" card (F15). One render (= one media row) becomes up to
 * four draft items, one per platform; the card shows them as a group.
 */

export const PLATFORM_SHORT: Record<Platform, string> = { instagram: "IG", youtube: "YT", tiktok: "TT", snapchat: "SC" };

export interface EditorChip {
  label: string;
  tone: "danger" | "warn";
  /** Platforms the chip applies to, in PLATFORMS order. */
  platforms: Platform[];
}

export interface PlatformLine {
  itemId: string;
  platform: Platform;
  /** "Today 18:30" / "Tomorrow 09:30" / "Mon 16 Nov 18:30"; "No slot" when untimed. */
  slot: string;
  blocked: boolean;
  /** First block message (for the "stays" reason), else null. */
  blockReason: string | null;
}

export interface EditorRender {
  /** `${batchId}:${mediaId}`: stable React key and form id. */
  key: string;
  batchId: string;
  mediaId: string;
  label: string;
  durationS: number | null;
  pillar: string | null;
  source: string | null;
  /** First two caption lines (the first non-empty caption, IG first). Empty string when none. */
  captionLines: string[];
  lines: PlatformLine[];
  /** Block chips first, then warn chips; identical labels merged across platforms. */
  chips: EditorChip[];
  itemIds: string[];
  /** Items with no block warning: what one "Approve & schedule" tap approves. */
  approvableIds: string[];
  /** For editing: per item caption/title. */
  edits: Array<{ itemId: string; platform: Platform; caption: string; title: string | null }>;
  /** Newest createdAt of the group (ISO), for ordering. */
  newest: string;
}

/** Item as the card needs it: a batch item view with warnings filled (createdAt orders the renders). */
export type EditorItem = BatchItemView;

const ORDER = new Map(PLATFORMS.map((p, i) => [p, i]));
const byPlatform = (a: { platform: Platform }, b: { platform: Platform }) => (ORDER.get(a.platform) ?? 9) - (ORDER.get(b.platform) ?? 9);

/** "Today 18:30" / "Tomorrow 09:30" / "Mon 16 Nov 18:30" in the creator's zone; "No slot" when untimed/invalid. */
export function slotLabel(iso: string | null, now: Date, timeZone: string): string {
  if (iso == null) return "No slot";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "No slot";
  const day = localDate(at, timeZone);
  const today = localDate(now, timeZone);
  const time = localHHMM(at, timeZone);
  if (day === today) return `Today ${time}`;
  if (day === addCalendarDays(today, 1)) return `Tomorrow ${time}`;
  return `${dayLabel(day)} ${time}`;
}

/** The first `n` non-empty lines of a caption, each trimmed. */
export function firstLines(caption: string, n = 2): string[] {
  return caption
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, n);
}

/** Short chip text for a warning on the editor card. */
export function chipLabel(w: Pick<Warning, "code" | "message">): string {
  switch (w.code) {
    case "caption.missing":
      return w.message === "needs a title" ? "Needs title" : "Needs caption";
    case "sound.in-app":
      return "Add sound in app or post as-is";
    case "time.missing":
      return "No free slot today";
    case "tiktok.draft-limit":
      return "TikTok draft limit (5 per 24 h)";
    case "tiktok.needs-sound":
      return "TikTok inbox draft";
    case "lint.error":
    case "lint.warn":
      return `Lint: ${w.message}`;
    default:
      return w.message;
  }
}

/**
 * Chips for a set of items: one per (tone, label), listing the platforms it hits. tiktok.needs-sound is
 * dropped when the same item carries sound.in-app (one message about the sound is enough).
 */
export function renderChips(items: Array<Pick<BatchItemView, "platform" | "warnings">>): EditorChip[] {
  const map = new Map<string, EditorChip>();
  for (const item of [...items].sort(byPlatform)) {
    const codes = new Set(item.warnings.map((w) => w.code));
    for (const w of item.warnings) {
      if (w.code === "tiktok.needs-sound" && codes.has("sound.in-app")) continue;
      const tone = w.severity === "block" ? "danger" : "warn";
      const label = chipLabel(w);
      const k = `${tone}|${label}`;
      const chip = map.get(k) ?? { label, tone, platforms: [] };
      if (!chip.platforms.includes(item.platform)) chip.platforms.push(item.platform);
      map.set(k, chip);
    }
  }
  const all = [...map.values()];
  return [...all.filter((c) => c.tone === "danger"), ...all.filter((c) => c.tone === "warn")];
}

/** "IG, TT" for a chip. */
export function platformsShort(ps: Platform[]): string {
  return ps.map((p) => PLATFORM_SHORT[p]).join(", ");
}

const firstBlock = (i: Pick<BatchItemView, "warnings">) => i.warnings.find((w) => w.severity === "block") ?? null;

/** Groups editor drafts into renders (batch + media), newest render first; items in platform order. */
export function groupRenders(items: EditorItem[], now: Date, timeZone: string): EditorRender[] {
  const groups = new Map<string, EditorItem[]>();
  for (const i of items) {
    if (i.origin !== "editor" || i.status !== "draft") continue;
    const k = `${i.batchId}:${i.mediaId}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const out: EditorRender[] = [];
  for (const [key, raw] of groups) {
    const g = [...raw].sort(byPlatform);
    const head = g[0]!;
    const caption = g.find((i) => i.caption.trim() !== "")?.caption ?? "";
    const meta = g.find((i) => i.editor)?.editor ?? null;
    out.push({
      key,
      batchId: head.batchId,
      mediaId: head.mediaId,
      label: head.media.label,
      durationS: head.media.durationS,
      pillar: meta?.pillar ?? head.media.pillar,
      source: meta?.source ?? null,
      captionLines: firstLines(caption, 2),
      lines: g.map((i) => {
        const b = firstBlock(i);
        return { itemId: i.id, platform: i.platform, slot: slotLabel(i.scheduledFor, now, timeZone), blocked: b != null, blockReason: b ? chipLabel(b) : null };
      }),
      chips: renderChips(g),
      itemIds: g.map((i) => i.id),
      approvableIds: g.filter((i) => firstBlock(i) == null).map((i) => i.id),
      edits: g.map((i) => ({ itemId: i.id, platform: i.platform, caption: i.caption, title: i.title })),
      newest: g.reduce((m, i) => ((i.createdAt ?? "") > m ? (i.createdAt ?? "") : m), head.createdAt ?? ""),
    });
  }
  return out.sort((a, b) => (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : a.key.localeCompare(b.key)));
}

/** The approve button's text: "Approve & schedule" (all), "Approve 2 of 3", or null when nothing is approvable. */
export function approveLabel(r: Pick<EditorRender, "approvableIds" | "itemIds">): string | null {
  if (r.approvableIds.length === 0) return null;
  if (r.approvableIds.length === r.itemIds.length) return "Approve & schedule";
  return `Approve ${r.approvableIds.length} of ${r.itemIds.length}`;
}

/** The note after an approve tap: "approved IG, YT · stayed: TT (Needs caption)". */
export function approveNote(approved: Platform[], stayed: Array<{ platform: Platform; reason: string }>): string {
  const a = approved.length ? `approved ${platformsShort(approved)}` : "nothing approved";
  if (stayed.length === 0) return `${a}: scheduled, nothing goes out before its time`;
  return `${a} · stayed: ${stayed.map((s) => `${PLATFORM_SHORT[s.platform]} (${s.reason})`).join(", ")}`;
}
