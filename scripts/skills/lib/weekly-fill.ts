// weekly-batch `pending` / `fill` (F14 T2): captions for the draft items the Sunday weekly-draft job
// (and the editor pipeline) leave with empty text. `pending` lists them; `fill` runs the same caption
// lint as checkDraft (one rule set, not a fork) and, only with --write, stores caption/title.
// Never approves, never publishes: the items stay 'draft' and the creator approves on the phone.
import { addCalendarDays, localDate, localHHMM, localToUtc, weekdayIndex, type Platform } from "../../../packages/core/src/index.js";
import { checkDraft, type BatchDraft, type DraftCheck, type DraftFinding } from "./batch-draft.js";
import type { InsertClient } from "./batch-draft.js";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Monday (creator-local) after `now`: on a Monday that is next week's Monday, never today. */
export function nextWeekStart(now: Date, timeZone: string): string {
  const today = localDate(now, timeZone);
  return addCalendarDays(today, 7 - weekdayIndex(today));
}

/** A YYYY-MM-DD that is a real date, moved back to its Monday; null when it isn't a date. */
export function weekOf(raw: string | undefined): string | null {
  if (!raw || !YMD.test(raw)) return null;
  const t = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== raw) return null;
  return addCalendarDays(raw, -weekdayIndex(raw));
}

/**
 * Draft items of a creator-local week that still need text: empty caption, or a YouTube item with an
 * empty title. Week membership = the calendar's rule: timed items by their time, untimed drafts by their
 * batch's week. Any origin (weekly job, editor, app). Same predicate as the Home card
 * (apps/web/lib/home/dashboard.ts HOME_SQL.needsCaptions); keep the two in step.
 * $1 week start (date), $2 / $3 the week's UTC bounds.
 */
export const PENDING_SQL = `
  select bi.id, bi.media_id, bi.platform, bi.caption, bi.title, bi.scheduled_for, bi.origin,
         m.pillar, m.duration_s, m.source_path
    from batch_items bi
    join batches b on b.id = bi.batch_id
    join media m on m.id = bi.media_id
   where bi.status = 'draft'
     and b.status <> 'archived'
     and ((bi.scheduled_for >= $2 and bi.scheduled_for < $3) or (bi.scheduled_for is null and b.week_start = $1::date))
     and (btrim(bi.caption) = '' or (bi.platform = 'youtube' and coalesce(btrim(bi.title), '') = ''))
   order by bi.scheduled_for nulls last, bi.media_id, bi.platform, bi.id`;

/** One line of the pending list. `caption` / `title` are the current text, so the file doubles as the fill template. */
export interface PendingItem {
  id: string;
  mediaId: string;
  platform: Platform;
  pillar: string | null;
  /** Creator-local, "Mon 2026-11-23 18:30"; null = no time yet. */
  scheduledFor: string | null;
  durationS: number | null;
  /** File basename only (never the folder path). */
  label: string | null;
  origin: string | null;
  caption: string;
  /** YouTube only. */
  title?: string;
}

export const basename = (p: string | null | undefined): string | null => (p ? (p.split(/[\\/]/).pop() || null) : null);

export function localSlot(at: Date | string | null, timeZone: string): string | null {
  if (at == null) return null;
  const d = new Date(at);
  const day = localDate(d, timeZone);
  return `${WD[weekdayIndex(day)]} ${day} ${localHHMM(d, timeZone)}`;
}

export async function listPending(db: InsertClient, weekStart: string, timeZone: string): Promise<PendingItem[]> {
  const from = localToUtc(weekStart, "00:00", timeZone);
  const to = localToUtc(addCalendarDays(weekStart, 7), "00:00", timeZone);
  const { rows } = await db.query(PENDING_SQL, [weekStart, from, to]);
  return rows.map((r) => ({
    id: r.id,
    mediaId: r.media_id,
    platform: r.platform as Platform,
    pillar: r.pillar ?? null,
    scheduledFor: localSlot(r.scheduled_for, timeZone),
    durationS: r.duration_s == null ? null : Number(r.duration_s),
    label: basename(r.source_path),
    origin: r.origin ?? null,
    caption: r.caption ?? "",
    ...(r.platform === "youtube" ? { title: r.title ?? "" } : {}),
  }));
}

/** "12 posts need text (9 captions, 3 YouTube titles) across 4 clips". */
export function pendingSummary(items: PendingItem[]): string {
  const captions = items.filter((i) => !i.caption.trim()).length;
  const titles = items.filter((i) => i.platform === "youtube" && !(i.title ?? "").trim()).length;
  const clips = new Set(items.map((i) => i.mediaId)).size;
  return `${items.length} post(s) need text (${captions} caption(s), ${titles} YouTube title(s)) across ${clips} clip(s)`;
}

// ---------------------------------------------------------------- fill

export interface FillEntry {
  id: string;
  caption: string;
  title?: string;
}

/** Parses the fill file: an array of {id, caption, title?}. Extra keys (from the pending list) are ignored. */
export function parseFillFile(raw: unknown): FillEntry[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : null;
  if (!list) throw new Error("fill file must be a JSON array of {id, caption, title?}");
  const seen = new Set<string>();
  return list.map((e, i) => {
    const o = e as Record<string, unknown>;
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !UUID.test(o.id)) throw new Error(`entry ${i + 1}: id must be a batch item uuid`);
    if (typeof o.caption !== "string") throw new Error(`entry ${i + 1}: caption must be a string`);
    if (o.title !== undefined && o.title !== null && typeof o.title !== "string") throw new Error(`entry ${i + 1}: title must be a string`);
    if (seen.has(o.id.toLowerCase())) throw new Error(`entry ${i + 1}: id listed twice`);
    seen.add(o.id.toLowerCase());
    return { id: o.id, caption: o.caption, ...(typeof o.title === "string" ? { title: o.title } : {}) };
  });
}

/** What fill needs to know about each target item (loaded from the DB). */
export interface FillTarget {
  id: string;
  mediaId: string;
  platform: Platform;
  status: string;
  pillar: string | null;
  title: string | null;
  weekStart: string;
}

export interface FillFinding extends Pick<DraftFinding, "rule" | "severity" | "message" | "field"> {
  id: string;
  platform: Platform | "item";
}
export interface FillCheck {
  ok: boolean;
  entries: number;
  errors: number;
  warnings: number;
  findings: FillFinding[];
}

/**
 * Lints the fill entries with checkDraft (voice lint, PRIVACY_BLOCKLIST, IG ≤5 hashtags, YouTube title
 * required, empty caption, duplicate captions), one draft item per entry. Times aren't part of fill, so
 * "not creatable" is ignored. A clip with no pillar yet is linted without one (pillar isn't fill's job).
 * Unknown ids and items that aren't 'draft' are errors: fill never touches an approved or rejected item.
 */
export function checkFill(entries: FillEntry[], targets: FillTarget[], opts: { blocklist?: string[]; now?: Date } = {}): FillCheck {
  const byId = new Map(targets.map((t) => [t.id.toLowerCase(), t]));
  const findings: FillFinding[] = [];
  const linted: Array<{ entry: FillEntry; target: FillTarget }> = [];
  for (const entry of entries) {
    const t = byId.get(entry.id.toLowerCase());
    if (!t) findings.push({ id: entry.id, platform: "item", field: "batch", rule: "fill.unknown", severity: "error", message: "no such batch item" });
    else if (t.status !== "draft") findings.push({ id: entry.id, platform: t.platform, field: "batch", rule: "fill.not-draft", severity: "error", message: `item is ${t.status}, not draft: fill only writes drafts` });
    else linted.push({ entry, target: t });
  }
  if (linted.length) {
    const draft: BatchDraft = {
      weekStart: linted[0]!.target.weekStart,
      items: linted.map(({ entry, target }) => ({
        mediaId: target.mediaId,
        pillar: target.pillar ?? "",
        posts: { [target.platform]: { caption: entry.caption, ...(target.platform === "youtube" ? { title: entry.title ?? target.title ?? "" } : {}) } },
      })),
    };
    const check: DraftCheck = checkDraft(draft, opts);
    for (const f of check.findings) {
      if (f.item < 0) continue; // batch-level (week format / empty) can't happen here
      const { entry, target } = linted[f.item]!;
      if (f.rule === "item.pillar" && !target.pillar) continue;
      findings.push({ id: entry.id, platform: f.platform, field: f.field, rule: f.rule, severity: f.severity, message: f.message });
    }
  }
  const errors = findings.filter((f) => f.severity === "error").length;
  return { ok: errors === 0 && entries.length > 0, entries: entries.length, errors, warnings: findings.length - errors, findings };
}

export function formatFillFindings(check: FillCheck): string {
  return check.findings.map((f) => `${f.severity.toUpperCase()} ${f.id} ${f.platform} ${f.field}: ${f.message} [${f.rule}]`).join("\n");
}

export const FILL_TARGETS_SQL = `
  select bi.id, bi.media_id, bi.platform, bi.status, bi.title, m.pillar, to_char(b.week_start, 'YYYY-MM-DD') as week_start
    from batch_items bi join batches b on b.id = bi.batch_id join media m on m.id = bi.media_id
   where bi.id = any($1::uuid[])`;

export async function loadFillTargets(db: InsertClient, ids: string[]): Promise<FillTarget[]> {
  const { rows } = await db.query(FILL_TARGETS_SQL, [ids]);
  return rows.map((r) => ({
    id: r.id,
    mediaId: r.media_id,
    platform: r.platform as Platform,
    status: r.status,
    pillar: r.pillar ?? null,
    title: r.title ?? null,
    weekStart: r.week_start,
  }));
}

/**
 * Writes the checked entries in ONE transaction on one connection: per item caption (+ title on YouTube),
 * updated_at, and a batch_item_events 'edit' row (draft → draft, detail = the patch, like the app's edit).
 * Re-checks under a row lock: if any item stopped being 'draft' meanwhile, nothing is written.
 * Status, times and approval stamps are never touched.
 */
export async function writeFill(client: InsertClient, entries: FillEntry[], opts: { blocklist?: string[]; now?: Date } = {}): Promise<{ written: number }> {
  const now = opts.now ?? new Date();
  await client.query("begin");
  try {
    const ids = entries.map((e) => e.id);
    const { rows } = await client.query(`select id from batch_items where id = any($1::uuid[]) order by id for update`, [ids]);
    if (rows.length !== ids.length) throw new Error("some items are gone, nothing written");
    const loaded = await loadFillTargets(client, ids);
    const check = checkFill(entries, loaded, opts);
    if (!check.ok) throw new Error(`${check.errors} error(s), nothing written`);
    const targets = new Map(loaded.map((t) => [t.id.toLowerCase(), t]));
    for (const e of entries) {
      const t = targets.get(e.id.toLowerCase())!;
      const yt = t.platform === "youtube";
      const title = yt ? (e.title ?? t.title ?? "") : null;
      const res = await client.query(
        `update batch_items set caption = $2, title = case when platform = 'youtube' then $3 else title end, updated_at = $4
          where id = $1 and status = 'draft' returning id`,
        [e.id, e.caption, title, now],
      );
      if (res.rows.length !== 1) throw new Error("an item stopped being a draft, nothing written");
      const detail = { caption: e.caption, ...(yt ? { title } : {}), via: "skill:weekly-batch fill" };
      await client.query(
        `insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, session_id, at) values ($1, 'edit', 'draft', 'draft', $2::jsonb, null, $3)`,
        [e.id, JSON.stringify(detail), now],
      );
    }
    await client.query("commit");
    return { written: entries.length };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
}
