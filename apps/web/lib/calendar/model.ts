// Calendar (replaces "Batches"): pure grouping, roll-up, month/week matrices and URL state.
// No DB, no React. Tested in __tests__/model.test.ts. The loader is in load.ts.
import { addCalendarDays, clock12FromHHMM, localClock12, localDate, localHHMM, PLATFORMS, weekdayIndex, type Platform } from "@autopilot/core";
import type { BatchItemView, ItemStatus, Warning } from "../batches/types.js";
import { isMissedSlot } from "../status/posting.js";

// ---------------------------------------------------------------- status words

export type Tone = "neutral" | "accent" | "warn" | "danger";

/** Plain words for item statuses (no jargon). Rejected is hidden unless "Show rejected" is on. */
export const STATUS_WORD: Record<ItemStatus, string> = {
  draft: "Needs approval",
  approved: "Approved",
  queued: "Approved",
  publishing: "Posting",
  published: "Posted",
  failed: "Failed",
  unknown: "Check it",
  rejected: "Rejected",
};

export const STATUS_TONE: Record<ItemStatus, Tone> = {
  draft: "accent",
  approved: "neutral",
  queued: "neutral",
  publishing: "neutral",
  published: "neutral",
  failed: "danger",
  unknown: "warn",
  rejected: "neutral",
};

/** Roll-up of one entry's items, strongest first: needs-you > failed/unknown > approved > published > rejected. */
export type RollUp = "needs-you" | "attention" | "approved" | "published" | "rejected";
const RANK: Record<RollUp, number> = { "needs-you": 0, attention: 1, approved: 2, published: 3, rejected: 4 };

export function rollOf(status: ItemStatus): RollUp {
  if (status === "draft") return "needs-you";
  if (status === "failed" || status === "unknown") return "attention";
  if (status === "approved" || status === "queued" || status === "publishing") return "approved";
  if (status === "published") return "published";
  return "rejected";
}

export function rollUp(statuses: ItemStatus[]): RollUp {
  let best: RollUp = "rejected";
  for (const s of statuses) if (RANK[rollOf(s)] < RANK[best]) best = rollOf(s);
  return best;
}

/** The entry's badge: label + tone for the roll-up (failed beats "check it"; posting beats approved). */
export function rollUpBadge(statuses: ItemStatus[]): { label: string; tone: Tone } {
  const r = rollUp(statuses);
  if (r === "needs-you") return { label: "Needs approval", tone: "accent" };
  if (r === "attention") return statuses.includes("failed") ? { label: "Failed", tone: "danger" } : { label: "Check it", tone: "warn" };
  if (r === "approved") return statuses.includes("publishing") ? { label: "Posting", tone: "neutral" } : { label: "Approved", tone: "neutral" };
  if (r === "published") return { label: "Posted", tone: "neutral" };
  return { label: "Rejected", tone: "neutral" };
}

// ---------------------------------------------------------------- one state per platform line

/**
 * What one platform line of a card is, in the creator's words. The single source for card chips, the ⋯ menu,
 * the Approve-all count and dialog, and Home. `needs-approval` = a draft that the approve gate lets through;
 * `needs-fix` = a draft the gate refuses (`fix` carries the reason).
 */
export type LineState = "needs-approval" | "needs-fix" | "approved" | "posting" | "missed" | "posted" | "failed" | "unknown" | "share-by-hand" | "rejected";

export const LINE_LABEL: Record<LineState, string> = {
  "needs-approval": "Needs approval",
  "needs-fix": "Needs a fix",
  approved: "Approved",
  posting: "Posting",
  missed: "Missed",
  posted: "Posted",
  failed: "Failed",
  unknown: "Check it",
  "share-by-hand": "Share by hand",
  rejected: "Rejected",
};

export const LINE_TONE: Record<LineState, Tone> = {
  "needs-approval": "accent",
  "needs-fix": "warn",
  approved: "neutral",
  posting: "neutral",
  missed: "warn",
  posted: "neutral",
  failed: "danger",
  unknown: "warn",
  "share-by-hand": "accent",
  rejected: "neutral",
};

/**
 * Why a draft can't be approved right now, or null. Mirrors `approveBlocker` in batches/transitions.ts
 * (block warning, handed off, no time, past time): the server re-plans every approval with planTransition.
 */
export function approveBlockReason(i: Pick<BatchItemView, "status" | "warnings" | "handedOff" | "scheduledFor">, now: Date): string | null {
  if (i.status !== "draft") return `item is ${i.status}, not draft`;
  const block = i.warnings.find((w) => w.severity === "block");
  if (block) return block.message;
  if (i.handedOff) return "already handed to the platform";
  if (i.scheduledFor == null) return "no time set";
  const ms = new Date(i.scheduledFor).getTime();
  if (Number.isNaN(ms)) return "time is not a valid date";
  if (ms <= now.getTime()) return "time is in the past";
  return null;
}

export function lineState(i: BatchItemView, now: Date): { state: LineState; fix: string | null } {
  switch (i.status) {
    case "draft": {
      const fix = approveBlockReason(i, now);
      return fix ? { state: "needs-fix", fix } : { state: "needs-approval", fix: null };
    }
    case "approved":
    case "queued": {
      if (isMissedSlot(i, now)) return { state: "missed", fix: null };
      const ms = i.scheduledFor ? new Date(i.scheduledFor).getTime() : NaN;
      if (i.platform === "snapchat" && i.status === "approved" && Number.isFinite(ms) && ms <= now.getTime()) return { state: "share-by-hand", fix: null };
      return { state: "approved", fix: null };
    }
    case "publishing":
      return { state: "posting", fix: null };
    case "published":
      return { state: "posted", fix: null };
    case "failed":
      return { state: "failed", fix: null };
    case "unknown":
      return { state: "unknown", fix: null };
    default:
      return { state: "rejected", fix: null };
  }
}

/**
 * The card-level chip. All lines alike → that label. Mixed → the most pressing thing as a count
 * ("1 of 3 needs approval"); an approved card is never labelled "Needs approval" because of a sibling.
 */
export function cardChip(states: LineState[]): { label: string; tone: Tone } {
  const n = states.length;
  if (n === 0) return { label: LINE_LABEL.rejected, tone: "neutral" };
  const first = states[0]!;
  if (states.every((s) => s === first)) return { label: LINE_LABEL[first], tone: LINE_TONE[first] };
  const count = (s: LineState) => states.filter((x) => x === s).length;
  const na = count("needs-approval");
  if (na > 0) return { label: `${na} of ${n} ${na === 1 ? "needs" : "need"} approval`, tone: "accent" };
  for (const s of ["failed", "unknown"] as const) if (count(s) > 0) return { label: LINE_LABEL[s], tone: LINE_TONE[s] };
  const nf = count("needs-fix");
  if (nf > 0) return { label: `${nf} of ${n} ${nf === 1 ? "needs" : "need"} a fix`, tone: "warn" };
  for (const s of ["missed", "share-by-hand", "posting", "approved", "posted"] as const) if (count(s) > 0) return { label: LINE_LABEL[s], tone: LINE_TONE[s] };
  return { label: LINE_LABEL.rejected, tone: "neutral" };
}

// ---------------------------------------------------------------- entries

export interface PlatformEntry {
  itemId: string;
  batchId: string;
  platform: Platform;
  /** Local "HH:MM", or null when untimed. */
  time: string | null;
  scheduledFor: string | null;
  status: ItemStatus;
  /** The line's own state, label and tone (see lineState). */
  state: LineState;
  statusLabel: string;
  tone: Tone;
  /** Why a draft can't be approved (state "needs-fix"), else null. */
  fix: string | null;
  /** 12-hour display of `time` ("8:00 AM"). */
  time12: string | null;
  text: { caption: string; title: string | null };
  warnings: Warning[];
  /** state === "needs-approval". The server re-checks everything. */
  canApprove: boolean;
  canEdit: boolean;
  /** F11 "Not on the platform → back to draft" applies. */
  canReset: boolean;
  /** F11 "It's there → record it" applies (failed/unknown, never Snapchat). */
  canRecord: boolean;
  tiktokDraft: boolean;
  origin: "editor" | null;
  /** Snapchat item that is approved and due: shared by hand. */
  shareByHand: boolean;
  /** F18: approved, not Snapchat, more than an hour past its time; the worker won't send it (Move it). */
  missed?: boolean;
  /** Extra outbox facts for the F11 sheet. */
  attempts: number;
  lastError: string | null;
  keyTail: string | null;
}

export interface Entry {
  /** `${mediaId}|${day}` (day "none" when untimed). Stable, URL-safe after encodeURIComponent. */
  key: string;
  mediaId: string;
  /** Creator-local day, or null for untimed drafts. */
  day: string | null;
  title: string;
  /** First caption (IG first), may be "". */
  caption: string;
  pillar: string | null;
  durationS: number | null;
  platforms: PlatformEntry[];
  status: RollUp;
  statusLabel: string;
  tone: Tone;
  /** Earliest local time of the entry ("HH:MM"), null when untimed. */
  firstTime: string | null;
  /** Something here needs him: a draft, a failure or "check it". */
  needsYou: boolean;
  fromEditor: boolean;
}

const ORDER = new Map(PLATFORMS.map((p, i) => [p, i]));
const byPlatform = (a: { platform: Platform }, b: { platform: Platform }) => (ORDER.get(a.platform) ?? 9) - (ORDER.get(b.platform) ?? 9);
const firstLine = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";

/** Title = the YouTube title when there is one, else the media label, else the caption's first line. */
export function entryTitle(items: Array<Pick<BatchItemView, "platform" | "title" | "caption" | "media">>): string {
  const yt = items.find((i) => i.platform === "youtube" && i.title?.trim());
  if (yt) return yt.title!.trim();
  // A caption's first line reads better than a file label ("demo-0031"); the label is the last resort.
  const line = firstLine(items.find((i) => i.caption.trim())?.caption ?? "");
  if (line) return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
  return items[0]?.media.label?.trim() || "Untitled clip";
}

/** The niche tag: gym / trading as is, anything else kept, null when unknown. */
export function pillarTag(p: string | null | undefined): string | null {
  const v = (p ?? "").trim().toLowerCase();
  return v ? v : null;
}

function platformEntry(i: BatchItemView, timeZone: string, now: Date): PlatformEntry {
  const { state, fix } = lineState(i, now);
  const time = i.scheduledFor ? localHHMM(new Date(i.scheduledFor), timeZone) : null;
  return {
    itemId: i.id,
    batchId: i.batchId,
    platform: i.platform,
    time,
    time12: time ? clock12FromHHMM(time) : null,
    scheduledFor: i.scheduledFor,
    status: i.status,
    state,
    statusLabel: LINE_LABEL[state],
    tone: LINE_TONE[state],
    fix,
    text: { caption: i.caption, title: i.title },
    warnings: i.warnings,
    canApprove: state === "needs-approval",
    canEdit: i.editable,
    canReset: i.canReset === true,
    canRecord: (i.status === "failed" || i.status === "unknown") && i.platform !== "snapchat",
    tiktokDraft: i.tiktokDraft,
    origin: i.origin ?? null,
    shareByHand: state === "share-by-hand",
    missed: state === "missed",
    attempts: i.attempts ?? 0,
    lastError: i.lastError ?? null,
    keyTail: i.keyTail ?? null,
  };
}

/**
 * One entry per clip per creator-local day: the same clip on three platforms on one day is one entry;
 * the same clip on two days is two entries. Untimed items get day null. Rejected items are left out
 * unless `showRejected`. Entries come back ordered by day, then first time, then title.
 */
export function groupEntries(items: BatchItemView[], opts: { timeZone: string; now: Date; showRejected?: boolean }): Entry[] {
  const groups = new Map<string, BatchItemView[]>();
  for (const i of items) {
    if (i.status === "rejected" && !opts.showRejected) continue;
    const day = i.scheduledFor ? localDate(new Date(i.scheduledFor), opts.timeZone) : null;
    const key = `${i.mediaId}|${day ?? "none"}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(i);
  }
  const out: Entry[] = [];
  for (const [key, list] of groups) {
    list.sort(byPlatform);
    const platforms = list.map((i) => platformEntry(i, opts.timeZone, opts.now));
    const statuses = list.map((i) => i.status);
    const badge = cardChip(platforms.map((p) => p.state));
    const times = platforms.map((p) => p.time).filter((t): t is string => t != null).sort();
    const day = key.endsWith("|none") ? null : key.slice(key.lastIndexOf("|") + 1);
    const status = rollUp(statuses);
    out.push({
      key,
      mediaId: list[0]!.mediaId,
      day,
      title: entryTitle(list),
      caption: list.find((i) => i.caption.trim())?.caption ?? "",
      pillar: pillarTag(list[0]!.media.pillar),
      durationS: list[0]!.media.durationS,
      platforms,
      status,
      statusLabel: badge.label,
      tone: badge.tone,
      firstTime: times[0] ?? null,
      needsYou: status === "needs-you" || status === "attention",
      fromEditor: list.some((i) => i.origin === "editor"),
    });
  }
  return out.sort((a, b) => (a.day ?? "9999") .localeCompare(b.day ?? "9999") || (a.firstTime ?? "99").localeCompare(b.firstTime ?? "99") || a.title.localeCompare(b.title));
}

/** F18: the card's "Missed" chip — any of the entry's posts missed its time. */
export const entryMissed = (e: Pick<Entry, "platforms">): boolean => e.platforms.some((p) => p.missed === true);

// ---------------------------------------------------------------- approve all

export interface ApproveAllLine {
  itemId: string;
  /** "batchId:itemId", the form field value. */
  field: string;
  platform: Platform;
  /** Title or first caption line, at most 60 characters. */
  title: string;
  /** "Wed, Nov 18 · 8:00 AM" */
  when: string;
}

export interface ApproveAllView {
  total: number;
  groups: Array<{ platform: Platform; lines: ApproveAllLine[] }>;
  /** Drafts the gate refuses; not part of `total`. */
  notIncluded: Array<{ platform: Platform; title: string; reason: string }>;
}

const clip60 = (s: string) => (s.length > 60 ? `${s.slice(0, 57).trimEnd()}…` : s);

/** "Wed, Nov 18 · 8:00 AM" from a local day and "HH:MM". */
export function whenText(day: string | null, hhmm: string | null): string {
  const t = hhmm ? clock12FromHHMM(hhmm) : "no time";
  if (!day) return t;
  return `${WEEKDAYS[weekdayIndex(day)]}, ${MON[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))} · ${t}`;
}

/** "Fri 9:30 AM" for an instant in the creator zone (used by the reschedule confirms). */
export function slotText(iso: string, timeZone: string): string {
  const d = new Date(iso);
  return `${WEEKDAYS[weekdayIndex(localDate(d, timeZone))]} ${localClock12(d, timeZone)}`;
}

/** The Approve-all count and dialog content, from the same line states the cards use. */
export function approveAllView(entries: Entry[]): ApproveAllView {
  const by = new Map<Platform, ApproveAllLine[]>();
  const notIncluded: ApproveAllView["notIncluded"] = [];
  for (const e of entries) {
    for (const p of e.platforms) {
      const title = clip60(p.text.title?.trim() || firstLine(p.text.caption) || e.title);
      if (p.state === "needs-approval") {
        const list = by.get(p.platform) ?? by.set(p.platform, []).get(p.platform)!;
        list.push({ itemId: p.itemId, field: `${p.batchId}:${p.itemId}`, platform: p.platform, title, when: whenText(e.day, p.time) });
      } else if (p.state === "needs-fix") {
        notIncluded.push({ platform: p.platform, title, reason: p.fix ?? "needs a fix" });
      }
    }
  }
  const groups = PLATFORMS.filter((pl) => by.has(pl)).map((platform) => ({ platform, lines: by.get(platform)! }));
  return { total: groups.reduce((n, g) => n + g.lines.length, 0), groups, notIncluded };
}

/** Day Dialog order: by first time; with `draftsFirst` (`?status=draft`) the entries needing approval come first. */
export function dayEntries(entries: Entry[], day: string, draftsFirst = false): Entry[] {
  const list = entries.filter((e) => e.day === day);
  if (!draftsFirst) return list;
  return [...list.filter((e) => e.status === "needs-you"), ...list.filter((e) => e.status !== "needs-you")];
}

// ---------------------------------------------------------------- matrices

export interface DayCell {
  day: string;
  dayNum: number;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  /** Entries that day (ordered). */
  entries: Entry[];
  /** Platform items that day (for the phone count). */
  count: number;
  /** Up to 4 platforms with something that day (phone dots). */
  dots: Platform[];
  needsYou: boolean;
  /** Has an entry needing approval (for ?status=draft emphasis). */
  hasDrafts: boolean;
}

export const firstOfMonth = (ymd: string) => `${ymd.slice(0, 7)}-01`;
export function addMonths(ymd: string, n: number): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
}
export const mondayOf = (ymd: string) => addCalendarDays(ymd, -weekdayIndex(ymd));

function cell(day: string, inMonth: boolean, today: string, byDay: Map<string, Entry[]>): DayCell {
  const entries = byDay.get(day) ?? [];
  const plats = entries.flatMap((e) => e.platforms.map((p) => p.platform));
  return {
    day,
    dayNum: Number(day.slice(8, 10)),
    inMonth,
    isToday: day === today,
    isPast: day < today,
    entries,
    count: plats.length,
    dots: PLATFORMS.filter((p) => plats.includes(p)).slice(0, 4),
    needsYou: entries.some((e) => e.needsYou),
    hasDrafts: entries.some((e) => e.status === "needs-you"),
  };
}

function index(entries: Entry[]): Map<string, Entry[]> {
  const m = new Map<string, Entry[]>();
  for (const e of entries) if (e.day) (m.get(e.day) ?? m.set(e.day, []).get(e.day)!).push(e);
  return m;
}

/** Month grid, weeks start Monday, with the leading/trailing days of the neighbouring months. */
export function monthMatrix(anchor: string, today: string, entries: Entry[] = []): DayCell[][] {
  const first = firstOfMonth(anchor);
  const next = addMonths(first, 1);
  const start = mondayOf(first);
  const byDay = index(entries);
  const weeks: DayCell[][] = [];
  for (let d = start; d < next || weeks.length === 0; ) {
    const week: DayCell[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cell(d, d >= first && d < next, today, byDay));
      d = addCalendarDays(d, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Monday–Sunday of the week holding `anchor`. */
export function weekCells(anchor: string, today: string, entries: Entry[] = []): DayCell[] {
  const start = mondayOf(anchor);
  const byDay = index(entries);
  return Array.from({ length: 7 }, (_, i) => cell(addCalendarDays(start, i), true, today, byDay));
}

/** First and last day (inclusive) a view shows. */
export function viewRange(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === "week") {
    const from = mondayOf(anchor);
    return { from, to: addCalendarDays(from, 6) };
  }
  const first = firstOfMonth(anchor);
  const from = mondayOf(first);
  const lastOfMonth = addCalendarDays(addMonths(first, 1), -1);
  return { from, to: addCalendarDays(mondayOf(lastOfMonth), 6) };
}

// ---------------------------------------------------------------- labels

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const monthTitle = (ymd: string) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
/** "Nov 16 – 22", "Nov 30 – Dec 6". */
export function weekTitle(anchor: string): string {
  const a = mondayOf(anchor);
  const b = addCalendarDays(a, 6);
  const md = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
  return a.slice(0, 7) === b.slice(0, 7) ? `${md(a)} – ${Number(b.slice(8, 10))}` : `${md(a)} – ${md(b)}`;
}
/** "Wednesday, November 18". */
export function dayTitle(ymd: string): string {
  return `${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][weekdayIndex(ymd)]}, ${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;
}

// ---------------------------------------------------------------- URL state

export type CalendarView = "month" | "week";

export interface CalendarState {
  view: CalendarView;
  /** Anchor day (YYYY-MM-DD) of the view. */
  d: string;
  /** Day Dialog. */
  day: string | null;
  /** `?status=draft`: emphasise what needs approval; the Day Dialog lists drafts first. */
  drafts: boolean;
  showRejected: boolean;
  /** Entry key for the text editor / move dialog / reject confirm; item id for the F11 sheet. */
  edit: string | null;
  move: string | null;
  reject: string | null;
  reset: string | null;
  approveAll: boolean;
  /** Reschedule-missed confirm: one item id, or "all". */
  reschedule: string | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const validDay = (v: string | undefined): string | null => {
  if (!v || !YMD.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
};
const key = (v: string | undefined) => (v && v.length <= 120 && /^[0-9a-f-]{36}\|(\d{4}-\d{2}-\d{2}|none)$/i.test(v) ? v : null);
const uuid = (v: string | undefined) => (v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null);

export function parseCalendarState(sp: Record<string, string | string[] | undefined>, today: string): CalendarState {
  const day = validDay(one(sp.day));
  return {
    view: one(sp.view) === "week" ? "week" : "month",
    d: validDay(one(sp.d)) ?? day ?? today,
    day,
    drafts: one(sp.status) === "draft",
    showRejected: one(sp.rejected) === "1",
    edit: key(one(sp.edit)),
    move: key(one(sp.move)),
    reject: key(one(sp.reject)),
    reset: uuid(one(sp.reset)),
    approveAll: one(sp.approve) === "all",
    reschedule: one(sp.reschedule) === "all" ? "all" : uuid(one(sp.reschedule)),
  };
}

/** A /calendar URL for `state` with `over` applied. Dialog params are dropped unless given in `over`. */
export function calendarHref(state: CalendarState, over: Partial<CalendarState> = {}): string {
  const s: CalendarState = { ...state, day: null, edit: null, move: null, reject: null, reset: null, approveAll: false, reschedule: null, ...over };
  const q = new URLSearchParams();
  if (s.view === "week") q.set("view", "week");
  q.set("d", s.d);
  if (s.drafts) q.set("status", "draft");
  if (s.showRejected) q.set("rejected", "1");
  if (s.day) q.set("day", s.day);
  if (s.edit) q.set("edit", s.edit);
  if (s.move) q.set("move", s.move);
  if (s.reject) q.set("reject", s.reject);
  if (s.reset) q.set("reset", s.reset);
  if (s.approveAll) q.set("approve", "all");
  if (s.reschedule) q.set("reschedule", s.reschedule);
  return `/calendar?${q.toString()}`;
}

/** Previous / next anchor for the view (month: first of the month; week: ±7 days). */
export function stepAnchor(view: CalendarView, d: string, dir: -1 | 1): string {
  return view === "week" ? addCalendarDays(mondayOf(d), dir * 7) : addMonths(firstOfMonth(d), dir);
}

/** The redirect target for an old batch link: `/calendar?view=week&d=<week start>`. */
export function batchRedirect(weekStart: string | null): string {
  return weekStart && validDay(weekStart) ? `/calendar?view=week&d=${weekStart}` : "/calendar";
}

/** A post-action return path: only /calendar URLs and Home are accepted (never an open redirect). */
export function safeBack(raw: unknown): string {
  if (typeof raw !== "string") return "/calendar";
  if (raw === "/" || /^\/calendar(\?[A-Za-z0-9=&%._|:-]*)?$/.test(raw)) return raw;
  return "/calendar";
}

/** Adds `note` / `error` to a return path (replacing old ones) and drops dialog params that are done. */
export function withResult(back: string, r: { note?: string; error?: string }, drop: string[] = []): string {
  const [path, qs = ""] = back.split("?");
  const q = new URLSearchParams(qs);
  q.delete("note");
  q.delete("error");
  for (const k of drop) q.delete(k);
  if (r.error) q.set("error", r.error.slice(0, 200));
  else if (r.note) q.set("note", r.note.slice(0, 200));
  const s = q.toString();
  return s ? `${path}?${s}` : path!;
}

// ---------------------------------------------------------------- card links

/** Hrefs a card needs; the calendar builds them from its URL state, Home from the entry's own day. */
export interface CardLinks {
  edit: (key: string) => string;
  move: (key: string) => string;
  reject: (key: string) => string;
  reset: (itemId: string, day?: string | null) => string;
  /** Opens the "Auto-schedule at nearest slot" confirm for one missed post. */
  reschedule: (itemId: string, day?: string | null) => string;
  handoff: string;
}

/** Links for cards outside the calendar (Home): each opens its dialog on the calendar week of the post. */
export function linksFromHome(today: string): CardLinks {
  const state = (day: string | null | undefined): CalendarState => ({
    view: "week", d: day ?? today, day: null, drafts: false, showRejected: false, edit: null, move: null, reject: null, reset: null, approveAll: false, reschedule: null,
  });
  const dayOfKey = (key: string) => {
    const d = key.slice(key.lastIndexOf("|") + 1);
    return validDay(d);
  };
  return {
    edit: (key) => calendarHref(state(dayOfKey(key)), { edit: key }),
    move: (key) => calendarHref(state(dayOfKey(key)), { move: key }),
    reject: (key) => calendarHref(state(dayOfKey(key)), { reject: key }),
    reset: (itemId, day) => calendarHref(state(day), { reset: itemId }),
    reschedule: (itemId, day) => calendarHref(state(day), { reschedule: itemId }),
    handoff: "/platforms/snapchat",
  };
}
