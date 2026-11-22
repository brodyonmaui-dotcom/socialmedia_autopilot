/**
 * Pure view logic for the v3 Library (/library) and Touch-up (/library/touch-up) screens. No DB, no React:
 * pages pass the loaders' rows in (lib/library/data.ts) and render what comes out. Tested in
 * __tests__/screen.test.ts.
 */
import { localClock12, localDate, type Platform } from "@autopilot/core";
import { dayLabel } from "../batches/view-model.js";
import { batchRedirect, mondayOf } from "../calendar/model.js";
import { PLATFORM_NAME } from "../platforms/view.js";
import type { ClipUse, FixStats, FixState, LibraryClip, TouchUpClip } from "./data.js";
import type { FixOp } from "./qa-issues.js";
import { tagLabel } from "./qa-issues.js";

type Raw = string | string[] | undefined;
const first = (v: Raw): string | undefined => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- Library URL state ----------

export interface LibraryParams {
  q: string;
  pillar: string | null;
  /** An info-tag code or "flagged". */
  tag: string | null;
  cursor: string | null;
  focus: string | null;
  /** Media id whose Dialog is open. */
  clip: string | null;
}

/** "Needs a touch-up" first, then the info tags the library shows on cards (qa-issues TAG_LABELS). */
export const TAG_FILTERS: readonly string[] = ["flagged", "no-sound", "silence-gaps", "landscape", "square", "tall", "frozen-middle", "black-middle", "too-long", "recheck"];

export function tagFilterLabel(code: string): string {
  return code === "flagged" ? "Needs a touch-up" : tagLabel(code);
}

export function parseLibraryParams(sp: Record<string, Raw>): LibraryParams {
  const q = (first(sp.q) ?? "").trim().slice(0, 80);
  const pillar = first(sp.pillar)?.trim() ?? "";
  const tag = first(sp.tag) ?? "";
  const cursor = first(sp.cursor) ?? "";
  const focus = first(sp.focus) ?? "";
  const clip = first(sp.clip) ?? "";
  return {
    q,
    pillar: /^[\w -]{1,40}$/.test(pillar) ? pillar : null,
    tag: TAG_FILTERS.includes(tag) ? tag : null,
    cursor: /^[\w-]{1,200}$/.test(cursor) ? cursor : null,
    focus: UUID.test(focus) ? focus : null,
    clip: UUID.test(clip) ? clip : null,
  };
}

/** "/library?q=…&pillar=…" with empty values left out (fixed key order, so links are stable). */
export function libraryUrl(p: Partial<LibraryParams>): string {
  const s = new URLSearchParams();
  if (p.q) s.set("q", p.q);
  if (p.pillar) s.set("pillar", p.pillar);
  if (p.tag) s.set("tag", p.tag);
  if (p.cursor) s.set("cursor", p.cursor);
  if (p.focus) s.set("focus", p.focus);
  if (p.clip) s.set("clip", p.clip);
  const q = s.toString();
  return q ? `/library?${q}` : "/library";
}

export interface FilterOption {
  label: string;
  href: string;
  current: boolean;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Pillar Dropdown: "All topics" then each pillar. Changing a filter drops the page cursor and any open dialog. */
export function pillarOptions(pillars: readonly string[], p: LibraryParams): FilterOption[] {
  const base = { ...p, cursor: null, clip: null, focus: null };
  const list = p.pillar && !pillars.includes(p.pillar) ? [...pillars, p.pillar] : pillars;
  return [
    { label: "All topics", href: libraryUrl({ ...base, pillar: null }), current: !p.pillar },
    ...list.map((x) => ({ label: cap(x), href: libraryUrl({ ...base, pillar: x }), current: p.pillar === x })),
  ];
}

/** Tag Dropdown: "Any tag", "Needs a touch-up", then the info tags. */
export function tagOptions(p: LibraryParams): FilterOption[] {
  const base = { ...p, cursor: null, clip: null, focus: null };
  return [
    { label: "Any tag", href: libraryUrl({ ...base, tag: null }), current: !p.tag },
    ...TAG_FILTERS.map((t) => ({ label: tagFilterLabel(t), href: libraryUrl({ ...base, tag: t }), current: p.tag === t })),
  ];
}

// ---------- Clip facts ----------

/** Seconds → "m:ss" (rounded), or null when unknown. */
export function durationText(s: number | null | undefined): string | null {
  if (s == null || !Number.isFinite(s) || s < 0) return null;
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** Card line: "Scheduled 2×", or null when the clip isn't in any post. */
export function scheduledShort(usedIn: number): string | null {
  return usedIn > 0 ? `Scheduled ${usedIn}×` : null;
}

/** Dialog line: "Scheduled in 2 posts" / "Not scheduled yet". */
export function scheduledLong(usedIn: number): string {
  return usedIn > 0 ? `Scheduled in ${plural(usedIn, "post")}` : "Not scheduled yet";
}

/** Status words a use line adds (from the item's own status only; approved/queued need no word). */
const USE_STATUS: Record<string, string> = { draft: "needs approval", publishing: "posting", published: "posted", failed: "failed", unknown: "check it" };

export interface ClipUseLine {
  key: string;
  /** "Instagram · Tue 24 Nov, 18:00" (creator-local), "TikTok · not timed yet"; a status word ("posted", "needs approval") only when the status says so. */
  text: string;
  /** The calendar week that holds it (`/calendar?view=week&d=<Monday>`), or the calendar for untimed posts. */
  href: string;
}

/** The Dialog's list under "Scheduled in N posts". `timeZone` is the calendar's creator zone (creatorZone()). */
export function clipUseLines(uses: readonly ClipUse[], timeZone: string): ClipUseLine[] {
  return uses.map((u, i) => {
    const name = PLATFORM_NAME[u.platform as Platform] ?? u.platform;
    const at = u.scheduledFor && !Number.isNaN(u.scheduledFor.getTime()) ? u.scheduledFor : null;
    const day = at ? localDate(at, timeZone) : null;
    const when = at && day ? `${dayLabel(day)}, ${localClock12(at, timeZone)}` : "not timed yet";
    const word = USE_STATUS[u.status];
    return { key: `${i}-${u.platform}-${at?.toISOString() ?? "untimed"}`, text: [name, when, word].filter(Boolean).join(" · "), href: batchRedirect(day ? mondayOf(day) : null) };
  });
}

/** Up to `max` quiet tags for a card: "Needs a touch-up" first when flagged, then the info tags. */
export function cardTags(c: Pick<LibraryClip, "flagged" | "tags">, max = 2): Array<{ code: string; label: string }> {
  const out = c.flagged > 0 ? [{ code: "flagged", label: tagFilterLabel("flagged") }, ...c.tags] : [...c.tags];
  return out.slice(0, max);
}

/** Accessible name for a library card: label, length, schedule, tags. */
export function clipAriaLabel(c: LibraryClip): string {
  const parts = [c.label, durationText(c.durationS), scheduledShort(c.usedIn)?.replace("×", " times"), ...cardTags(c, 9).map((t) => t.label)];
  return parts.filter(Boolean).join(", ");
}

/** Bytes → "18.4 MB" (decimal units, like the phone's Files app). */
export function sizeText(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

/** Integrated loudness → "−14.0 LUFS" (true minus sign); null → "No level". */
export function loudnessText(lufs: number | null | undefined): string {
  if (lufs == null || !Number.isFinite(lufs)) return "No level";
  return `${lufs < 0 ? "−" : ""}${Math.abs(lufs).toFixed(1)} LUFS`;
}

/** The three facts under a before / after thumb. Unknown stats → dashes, never zeros. */
export function statsFacts(s: FixStats | null): Array<{ label: string; value: string }> {
  return [
    { label: "Length", value: (s && durationText(s.durationS)) ?? "–" },
    { label: "Loudness", value: s ? loudnessText(s.loudnessLufs) : "–" },
    { label: "Size", value: (s && sizeText(s.sizeBytes)) ?? "–" },
  ];
}

// ---------- Touch-up ----------

/** "1 clip needs a touch-up" / "5 clips need a touch-up". */
export function touchUpHeadline(n: number): string {
  return n === 1 ? "1 clip needs a touch-up" : `${n} clips need a touch-up`;
}

/** What each fix step does, in plain words (the Fix all dialog and the card's "Fix it will…"). */
export const OP_TEXT: Record<FixOp, string> = {
  trim: "Trim the frozen or black ends",
  "remove-gaps": "Remove the silent pauses",
  reencode: "Re-save it in a format every platform takes",
  pad: "Fill it out to full 9:16",
  loudness: "Even out the sound level",
  strip: "Remove location and phone details",
};

/** Short names for `fix` issues (Fix all counts). */
const ISSUE_NAME: Record<string, string> = {
  "frozen-head": "Frozen start",
  "frozen-tail": "Frozen end",
  "black-head": "Black start",
  "black-tail": "Black end",
  "frozen-middle": "Mostly still",
  loudness: "Sound level",
  format: "File format",
  rotation: "Rotation",
  aspect: "Not quite 9:16",
  metadata: "Location or phone details",
};
export const issueName = (code: string) => ISSUE_NAME[code] ?? cap(code.replace(/-/g, " "));

/** A clip "Fix all" would queue: something fixable and no open fix (none yet, or the last one failed). */
export function canQueue(c: Pick<TouchUpClip, "fixOps" | "fix">): boolean {
  return c.fixOps.length > 0 && (c.fix.state === "none" || c.fix.state === "failed");
}

export interface FixAllPlan {
  /** Media ids to send (exactly the clips listed). */
  ids: string[];
  /** Per fixable issue: how many of those clips have it. Largest first. */
  issues: Array<{ code: string; name: string; n: number }>;
  /** The steps that will run across them, in fix order. */
  steps: string[];
}

export function fixAllPlan(clips: readonly TouchUpClip[]): FixAllPlan {
  const take = clips.filter(canQueue);
  const counts = new Map<string, number>();
  const ops = new Set<FixOp>();
  for (const c of take) {
    for (const o of c.fixOps) ops.add(o);
    for (const i of c.issues) if (i.fixable) counts.set(i.code, (counts.get(i.code) ?? 0) + 1);
  }
  return {
    ids: take.map((c) => c.mediaId),
    issues: [...counts.entries()].map(([code, n]) => ({ code, name: issueName(code), n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    steps: (Object.keys(OP_TEXT) as FixOp[]).filter((o) => ops.has(o)).map((o) => OP_TEXT[o]),
  };
}

export type CardStage = "fix" | "unfixable" | "fixing" | "review" | "failed";

/** Which block a Touch-up card shows. */
export function cardStage(c: Pick<TouchUpClip, "fixOps" | "fix">): CardStage {
  switch (c.fix.state) {
    case "queued":
    case "running":
      return "fixing";
    case "done":
      return "review";
    case "failed":
      return "failed";
    default:
      return c.fixOps.length ? "fix" : "unfixable";
  }
}

const STAGE_ORDER: Record<CardStage, number> = { review: 0, failed: 1, fix: 2, fixing: 3, unfixable: 4 };

/** Card order: decisions first (a fix to review, a failed fix), then what Fix it can do, then work in progress, then re-exports. Stable within a stage (newest first from the loader). */
export function touchUpOrder<T extends Pick<TouchUpClip, "fixOps" | "fix">>(clips: readonly T[]): T[] {
  return clips.map((c, i) => ({ c, i })).sort((a, b) => STAGE_ORDER[cardStage(a.c)] - STAGE_ORDER[cardStage(b.c)] || a.i - b.i).map((x) => x.c);
}

/** "Fixing…" sub-line: what it is doing, in order. */
export function fixingText(f: FixState): string {
  if (f.state !== "queued" && f.state !== "running") return "";
  const what = f.ops.filter((o) => o !== "strip").map((o) => OP_TEXT[o].toLowerCase());
  const head = f.state === "queued" ? "Waiting its turn" : "Working on it";
  return what.length ? `${head}: ${what.join(", ")}.` : `${head}.`;
}

// ---------- Result notes (after a form action, via the URL) ----------

/** Reasons the actions return; anything else shows a generic line (a URL can't inject text). */
const REASONS = new Set(["no clips selected", "something went wrong", "this fix isn't ready to keep", "unknown fix", "this fix can't be discarded", "unknown clip or issue"]);

export type NoteParams = Record<string, string | number>;

export function noteParams(r:
  | { kind: "queued"; queued: number; already: number; skipped: number }
  | { kind: "kept"; repointed: number; stayed: number }
  | { kind: "keptall"; kept: number; stayed: number; failed: number; stillFixing?: number; cantFix?: number }
  | { kind: "original" }
  | { kind: "dismissed" }
  | { kind: "error"; reason: string }): NoteParams {
  switch (r.kind) {
    case "queued":
      return { done: "queued", n: r.queued, already: r.already, skipped: r.skipped };
    case "kept":
      return { done: "kept", moved: r.repointed, stayed: r.stayed };
    case "keptall":
      return { done: "keptall", n: r.kept, stayed: r.stayed, failed: r.failed, fixing: r.stillFixing ?? 0, cant: r.cantFix ?? 0 };
    case "error":
      return { done: "error", reason: r.reason.slice(0, 60) };
    default:
      return { done: r.kind };
  }
}

/** `back` + the note params (replacing any earlier note). `back` must be a library path. */
export function withNote(back: string, note: NoteParams): string {
  const url = new URL(safeBack(back), "http://x");
  for (const k of ["done", "n", "already", "skipped", "moved", "stayed", "failed", "fixing", "cant", "reason"]) url.searchParams.delete(k);
  for (const [k, v] of Object.entries(note)) url.searchParams.set(k, String(v));
  return `${url.pathname}${url.search}`;
}

/** Only same-app library paths; anything else falls back to Touch-up. */
export function safeBack(raw: unknown, fallback = "/library/touch-up"): string {
  return typeof raw === "string" && /^\/library(?:\/touch-up)?(?:[?#]|$)/.test(raw) && !raw.includes("//") ? raw.slice(0, 600) : fallback;
}

const int = (v: Raw) => {
  const n = Number(first(v));
  return Number.isInteger(n) && n >= 0 && n < 10_000 ? n : 0;
};

/** The note line for `?done=…`, or null. */
export function resultNote(sp: Record<string, Raw>): { tone: "info" | "danger"; text: string } | null {
  switch (first(sp.done)) {
    case "queued": {
      const n = int(sp.n);
      const already = int(sp.already);
      const skipped = int(sp.skipped);
      const parts = [n ? `Fixing ${plural(n, "clip")}. Originals are kept.` : "Nothing new to fix."];
      if (already) parts.push(already === 1 ? "1 was already being fixed." : `${already} were already being fixed.`);
      if (skipped) parts.push(skipped === 1 ? "1 has nothing Fix it can change." : `${skipped} have nothing Fix it can change.`);
      return { tone: "info", text: parts.join(" ") };
    }
    case "kept":
      return { tone: "info", text: keepFixNote(int(sp.moved), int(sp.stayed)) };
    case "keptall":
      return { tone: int(sp.failed) && !int(sp.n) ? "danger" : "info", text: keepAllNote(int(sp.n), int(sp.stayed), int(sp.failed), int(sp.fixing), int(sp.cant)) };
    case "original":
      return { tone: "info", text: "Kept the original. The fixed copy is hidden, not deleted." };
    case "dismissed":
      return { tone: "info", text: "Dismissed. It won't count as needing a touch-up." };
    case "error": {
      const r = first(sp.reason) ?? "";
      return { tone: "danger", text: `That didn't work: ${REASONS.has(r) ? r : "something went wrong"}. Nothing was changed.` };
    }
    default:
      return null;
  }
}

/** "Kept the fix. 2 draft posts now use it; 1 approved post stays on the original." */
export function keepFixNote(moved: number, stayed: number): string {
  const a = moved === 0 ? "No draft posts used this clip" : moved === 1 ? "1 draft post now uses it" : `${moved} draft posts now use it`;
  const b = stayed === 0 ? "" : stayed === 1 ? "; 1 approved post stays on the original" : `; ${stayed} approved posts stay on the original`;
  return `Kept the fix. ${a}${b}.`;
}

/** "Kept 5 · 2 posts stay on the original (already approved) · 1 couldn't be kept" */
export function keepAllNote(kept: number, stayed: number, failed: number, stillFixing = 0, cantFix = 0): string {
  const parts = [kept ? `Kept ${kept}` : "Nothing to keep"];
  if (stayed) parts.push(`${stayed === 1 ? "1 post stays" : `${stayed} posts stay`} on the original (already approved)`);
  if (failed) parts.push(`${failed} couldn't be kept`);
  if (stillFixing) parts.push(`${stillFixing} still fixing`);
  if (cantFix) parts.push(`${cantFix} can't be fixed automatically`);
  return parts.join(" · ");
}

/** "Fixing 3 of 8 · about 1 a minute" (empty when nothing is pending). */
export function fixProgressText(pending: number, done: number): string {
  return pending > 0 ? `Fixing ${pending} of ${pending + done} · about 1 a minute` : "";
}

/** `/touch-up?x=1` → `/library/touch-up?x=1` (old route, query kept). */
export function touchUpRedirect(sp: Record<string, Raw>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) s.append(k, x);
  const q = s.toString();
  return q ? `/library/touch-up?${q}` : "/library/touch-up";
}
