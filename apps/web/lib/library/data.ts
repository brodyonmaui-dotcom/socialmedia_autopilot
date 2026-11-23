/**
 * Library + Touch-up data layer (server only). Loaders read; the mutations only change statuses or add
 * rows: nothing is ever deleted, no file is touched (the worker does the ffmpeg work, see
 * apps/worker/src/jobs/media-fix.ts), and nothing here publishes. "Keep the fix" re-points DRAFT calendar
 * items only; approved / handed-off items keep the file that was approved.
 */
import { checkFolderLabel } from "@autopilot/core";
import type { Pool } from "pg";
import { mediaLabel } from "../batches/pg-store.js";
import { availableOps, flaggedIssues, focusHref, infoTags, issuesOf, resolveOps, type FixOp, type QaIssue } from "./qa-issues.js";

export type Db = Pick<Pool, "query">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/** Media rows the library hides: a fixed copy waiting for a decision (or rejected), and an original whose fix was kept. */
const HIDDEN = `(
  exists (select 1 from media_fixes hf where hf.fixed_media_id = m.id and hf.status in ('queued','running','done','discarded','failed'))
  or exists (select 1 from media_fixes hk where hk.media_id = m.id and hk.status = 'kept')
)`;

// ---------- Library ----------

export interface LibraryQuery {
  q?: string;
  pillar?: string;
  /** An info-tag code (e.g. "no-sound"), or "flagged" for clips with open fix issues. */
  tag?: string;
  cursor?: string | null;
  /** Media id from `?focus=`: returned first when it exists. */
  focus?: string | null;
  limit?: number;
}

export interface LibraryClip {
  mediaId: string;
  label: string;
  durationS: number | null;
  pillar: string | null;
  status: string;
  /** Info tags ("No sound yet", "Landscape"). */
  tags: Array<{ code: string; label: string }>;
  /** Open fix issues (not dismissed); the Touch-up count. */
  flagged: number;
  /** Poster via /api/media/<mediaId>/poster when true. */
  hasPoster: boolean;
  /** Calendar items using this clip (any status except rejected). */
  usedIn: number;
  /** Set on a kept fixed copy: the original it came from. */
  derivedFrom: string | null;
  /** Library folder label (media.folder, migration 0016), or null: the screen groups by week then. */
  folder: string | null;
  /** ISO instant the week bucket comes from: captured_at, else created_at. */
  at: string;
  focused: boolean;
  href: string;
}

export interface LibraryPage {
  clips: LibraryClip[];
  nextCursor: string | null;
}

interface LibraryRow {
  id: string;
  source_path: string | null;
  duration_s: string | number | null;
  pillar: string | null;
  status: string;
  qa: unknown;
  poster_key: string | null;
  derived_from: string | null;
  folder: string | null;
  captured_at: Date | null;
  created_at: Date;
  used_in: number;
  dismissed: string[] | null;
}

const LIBRARY_COLUMNS = `m.id, m.source_path, m.duration_s, m.pillar, m.status, m.qa, m.poster_key, m.derived_from, m.folder, m.captured_at, m.created_at,
  (select count(*)::int from batch_items bi where bi.media_id = m.id and bi.status <> 'rejected') as used_in,
  (select array_agg(td.code) from touchup_dismissals td where td.media_id = m.id and td.undone_at is null) as dismissed`;

function encodeCursor(r: { created_at: Date; id: string }): string {
  return Buffer.from(`${new Date(r.created_at).toISOString()}|${r.id}`).toString("base64url");
}
function decodeCursor(c: string | null | undefined): { at: string; id: string } | null {
  if (!c) return null;
  const [at, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
  return at && !Number.isNaN(Date.parse(at)) && isUuid(id) ? { at, id } : null;
}
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function toClip(r: LibraryRow, focused: boolean): LibraryClip {
  const issues = issuesOf(r.qa);
  const label = mediaLabel(r.source_path, r.id);
  const n = r.duration_s == null ? null : Number(r.duration_s);
  return {
    mediaId: r.id,
    label,
    durationS: n != null && Number.isFinite(n) ? n : null,
    pillar: r.pillar,
    status: r.status,
    tags: infoTags(issues),
    flagged: flaggedIssues(issues, r.dismissed ?? []).length,
    hasPoster: !!r.poster_key,
    usedIn: r.used_in,
    derivedFrom: r.derived_from,
    folder: r.folder,
    at: new Date(r.captured_at ?? r.created_at).toISOString(),
    focused,
    href: focusHref(label, r.id),
  };
}

const matchesTag = (c: LibraryClip, tag: string | undefined) => !tag || (tag === "flagged" ? c.flagged > 0 : c.tags.some((t) => t.code === tag));

/** Newest first, keyset-paged. `q` matches the file name or pillar; the focused clip (if any) comes first on page 1. */
export async function loadLibrary(pool: Db, query: LibraryQuery = {}): Promise<LibraryPage> {
  const limit = Math.min(Math.max(query.limit ?? 60, 1), 200);
  const q = (query.q ?? "").trim().slice(0, 80);
  const cursor = decodeCursor(query.cursor);
  const params: unknown[] = [];
  const where = [`not ${HIDDEN}`];
  if (q) {
    params.push(`%${likeEscape(q)}%`);
    where.push(`(m.source_path ilike $${params.length} or m.pillar ilike $${params.length})`);
  }
  if (query.pillar) {
    params.push(query.pillar);
    where.push(`m.pillar = $${params.length}`);
  }
  if (cursor) {
    params.push(cursor.at, cursor.id);
    where.push(`(m.created_at, m.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  // The tag filter runs on mapped issues (legacy rows too), so over-fetch a little when it's set.
  params.push(query.tag ? limit * 4 : limit + 1);
  const { rows } = (await pool.query(
    `select ${LIBRARY_COLUMNS} from media m where ${where.join(" and ")} order by m.created_at desc, m.id desc limit $${params.length}`,
    params,
  )) as { rows: LibraryRow[] };

  const more = rows.length > (query.tag ? limit * 4 - 1 : limit);
  let clips = rows.map((r) => toClip(r, false)).filter((c) => matchesTag(c, query.tag));
  const page = clips.slice(0, limit);
  const lastRow = page.length ? rows.find((r) => r.id === page[page.length - 1]!.mediaId) : undefined;
  const nextCursor = (more || clips.length > limit) && lastRow ? encodeCursor(lastRow) : null;
  clips = page;

  if (!cursor && isUuid(query.focus)) {
    const f = (await pool.query(`select ${LIBRARY_COLUMNS} from media m where m.id = $1`, [query.focus])) as { rows: LibraryRow[] };
    if (f.rows[0]) clips = [toClip(f.rows[0], true), ...clips.filter((c) => c.mediaId !== query.focus)];
  }
  return { clips, nextCursor };
}

// ---------- Folders ----------

export interface FolderCount {
  folder: string;
  clips: number;
}

/** The labels in use (library-visible clips only), biggest first then A to Z: feeds the "Move to folder" picker. */
export async function loadFolders(pool: Db): Promise<FolderCount[]> {
  const { rows } = (await pool.query(
    `select m.folder, count(*)::int as n from media m where m.folder is not null and not ${HIDDEN} group by m.folder order by n desc, m.folder`,
  )) as { rows: Array<{ folder: string; n: number }> };
  return rows.map((r) => ({ folder: r.folder, clips: r.n }));
}

export type MoveResult = { ok: true; folder: string | null } | { ok: false; reason: string };

/** Sets (or clears, with null/blank) one clip's folder label. Touches nothing else; never deletes. */
export async function moveToFolder(pool: Db, mediaId: string, raw: unknown): Promise<MoveResult> {
  if (!isUuid(mediaId)) return { ok: false, reason: "unknown clip" };
  const blank = raw == null || (typeof raw === "string" && raw.trim() === "");
  const check = blank ? null : checkFolderLabel(raw);
  if (check && !check.ok) return { ok: false, reason: check.reason };
  const folder = check?.ok ? check.folder : null;
  const r = await pool.query("update media set folder = $2 where id = $1", [mediaId, folder]);
  return (r.rowCount ?? 0) > 0 ? { ok: true, folder } : { ok: false, reason: "unknown clip" };
}

// ---------- Clip dialog: where the clip is scheduled ----------

/** One calendar item using a clip (rejected ones never count, same rule as `usedIn`). */
export interface ClipUse {
  platform: string;
  scheduledFor: Date | null;
  status: string;
}

/**
 * The clip Dialog's "Where it's used" lines (only loaded for the open clip, never for the grid): up to
 * `limit` items, upcoming first (soonest first), then untimed drafts, then past ones (newest first).
 */
export async function loadClipUses(pool: Db, mediaId: string, now: Date, limit = 5): Promise<ClipUse[]> {
  if (!isUuid(mediaId)) return [];
  const { rows } = (await pool.query(
    `select bi.platform, bi.scheduled_for, bi.status
       from batch_items bi
      where bi.media_id = $1 and bi.status <> 'rejected'
      order by case when bi.scheduled_for >= $2 then 0 when bi.scheduled_for is null then 1 else 2 end,
               case when bi.scheduled_for >= $2 then bi.scheduled_for end asc,
               bi.scheduled_for desc,
               bi.id
      limit $3`,
    [mediaId, now, Math.min(Math.max(limit, 1), 20)],
  )) as { rows: Array<{ platform: string; scheduled_for: Date | string | null; status: string }> };
  return rows.map((r) => ({ platform: r.platform, scheduledFor: r.scheduled_for == null ? null : new Date(r.scheduled_for), status: r.status }));
}

// ---------- Touch-up ----------

export interface FixStats {
  durationS: number;
  loudnessLufs: number | null;
  videoCodec: string | null;
  width: number;
  height: number;
  sizeBytes: number;
}

export type FixState =
  | { state: "none" }
  | { state: "queued"; fixId: string; ops: FixOp[]; requestedAt: string }
  | { state: "running"; fixId: string; ops: FixOp[]; startedAt: string | null }
  | { state: "done"; fixId: string; ops: FixOp[]; fixedMediaId: string; before: FixStats | null; after: FixStats | null }
  | { state: "failed"; fixId: string; ops: FixOp[]; reason: string };

export interface TouchUpIssue {
  code: string;
  /** One plain sentence. */
  text: string;
  fixable: boolean;
}

export interface TouchUpClip {
  mediaId: string;
  label: string;
  pillar: string | null;
  durationS: number | null;
  hasPoster: boolean;
  issues: TouchUpIssue[];
  /** What "Fix it" would do (default set); empty = nothing auto-fixable, only Dismiss. */
  fixOps: FixOp[];
  /** Opt-in extras this clip allows (e.g. "remove-gaps"). */
  optionalOps: FixOp[];
  fix: FixState;
  libraryHref: string;
}

interface TouchUpRow {
  id: string;
  source_path: string | null;
  pillar: string | null;
  duration_s: string | number | null;
  qa: unknown;
  poster_key: string | null;
  dismissed: string[] | null;
  fix_id: string | null;
  fix_status: string | null;
  fix_ops: string[] | null;
  requested_at: Date | null;
  started_at: Date | null;
  fixed_media_id: string | null;
  before: FixStats | null;
  after: FixStats | null;
  error: string | null;
}

function fixState(r: TouchUpRow): FixState {
  const ops = (r.fix_ops ?? []) as FixOp[];
  switch (r.fix_status) {
    case "queued":
      return { state: "queued", fixId: r.fix_id!, ops, requestedAt: new Date(r.requested_at!).toISOString() };
    case "running":
      return { state: "running", fixId: r.fix_id!, ops, startedAt: r.started_at ? new Date(r.started_at).toISOString() : null };
    case "done":
      return r.fixed_media_id
        ? { state: "done", fixId: r.fix_id!, ops, fixedMediaId: r.fixed_media_id, before: r.before, after: r.after }
        : { state: "failed", fixId: r.fix_id!, ops, reason: "The fixed copy is missing." };
    case "failed":
      return { state: "failed", fixId: r.fix_id!, ops, reason: r.error || "The fix failed. Nothing was changed." };
    default:
      return { state: "none" };
  }
}

/**
 * Clips with open `fix` issues (v2 results only: legacy rows are never flagged), newest first, each with its
 * latest fix's state. Hidden: clips already decided (kept / kept original), fixed copies themselves, and
 * issues the creator dismissed.
 */
export async function loadTouchUp(pool: Db): Promise<TouchUpClip[]> {
  const { rows } = (await pool.query(
    `select m.id, m.source_path, m.pillar, m.duration_s, m.qa, m.poster_key,
            (select array_agg(td.code) from touchup_dismissals td where td.media_id = m.id and td.undone_at is null) as dismissed,
            f.id as fix_id, f.status as fix_status, f.ops as fix_ops, f.requested_at, f.started_at, f.fixed_media_id, f.before, f.after, f.error
       from media m
       left join lateral (select * from media_fixes x where x.media_id = m.id order by x.requested_at desc limit 1) f on true
      where m.qa->>'version' = '2'
        and jsonb_path_exists(m.qa, '$.issues[*] ? (@.severity == "fix")')
        and not exists (select 1 from media_fixes k where k.media_id = m.id and k.status in ('kept','discarded'))
        and not exists (select 1 from media_fixes c where c.fixed_media_id = m.id)
      order by m.created_at desc
      limit 500`,
  )) as { rows: TouchUpRow[] };
  const out: TouchUpClip[] = [];
  for (const r of rows) {
    const issues = issuesOf(r.qa);
    const dismissed = r.dismissed ?? [];
    const open = flaggedIssues(issues, dismissed);
    if (open.length === 0) continue;
    const label = mediaLabel(r.source_path, r.id);
    const n = r.duration_s == null ? null : Number(r.duration_s);
    const fixOps = resolveOps(issues, undefined, dismissed);
    out.push({
      mediaId: r.id,
      label,
      pillar: r.pillar,
      durationS: n != null && Number.isFinite(n) ? n : null,
      hasPoster: !!r.poster_key,
      issues: open.map((i: QaIssue) => ({ code: i.code, text: i.detail, fixable: i.fixable })),
      fixOps,
      optionalOps: availableOps(issues, dismissed).filter((o) => !fixOps.includes(o)),
      fix: fixState(r),
      libraryHref: focusHref(label, r.id),
    });
  }
  return out;
}

export interface RequestFixResult {
  /** New fixes queued. */
  queued: number;
  /** Already had an open fix (queued / running / done): unchanged. */
  already: number;
  /** Nothing fixable (or unknown clip): nothing queued. */
  skipped: number;
}

/**
 * Bulk "Fix it". Per clip: only the ops its fixable issues allow (`ops` undefined → the default set, which
 * leaves opt-in ops like remove-gaps off). Idempotent: one open fix per clip (partial unique index), so a
 * double tap or a re-sent form queues nothing new.
 */
export async function requestFix(pool: Db, mediaIds: readonly string[], ops: readonly string[] | undefined, sessionId: string | null): Promise<RequestFixResult> {
  const ids = [...new Set(mediaIds.filter(isUuid))].slice(0, 200);
  const res: RequestFixResult = { queued: 0, already: 0, skipped: mediaIds.length - ids.length };
  if (ids.length === 0) return res;
  const { rows } = (await pool.query(
    `select m.id, m.qa, (select array_agg(td.code) from touchup_dismissals td where td.media_id = m.id and td.undone_at is null) as dismissed
       from media m where m.id = any($1::uuid[])`,
    [ids],
  )) as { rows: Array<{ id: string; qa: unknown; dismissed: string[] | null }> };
  res.skipped += ids.length - rows.length;
  for (const r of rows) {
    const wanted = resolveOps(issuesOf(r.qa), ops, r.dismissed ?? []);
    if (wanted.length === 0) {
      res.skipped++;
      continue;
    }
    const ins = await pool.query(
      `insert into media_fixes (media_id, ops, session_id) values ($1, $2, $3)
       on conflict (media_id) where status in ('queued','running','done') do nothing returning id`,
      [r.id, wanted, isUuid(sessionId) ? sessionId : null],
    );
    if (ins.rows.length) res.queued++;
    else res.already++;
  }
  return res;
}

export type KeepFixResult = { ok: true; repointed: number; stayed: number } | { ok: false; reason: string };

/**
 * "Keep the fix": the fix becomes 'kept' and DRAFT calendar items move from the original to the fixed clip
 * (one batch_item_events 'edit' row each). Approved, queued, handed-off or published items are never
 * re-pointed (the approval was for the file he saw); `stayed` says how many. One statement, so it's atomic.
 */
export async function keepFix(pool: Db, fixId: string, sessionId: string | null): Promise<KeepFixResult> {
  if (!isUuid(fixId)) return { ok: false, reason: "unknown fix" };
  const { rows } = await pool.query(
    `with f as (
        update media_fixes set status = 'kept' where id = $1 and status = 'done' and fixed_media_id is not null
        returning media_id, fixed_media_id),
      moved as (
        update batch_items b set media_id = f.fixed_media_id, updated_at = now() from f
         where b.media_id = f.media_id and b.status = 'draft'
        returning b.id, f.media_id as from_id, f.fixed_media_id as to_id),
      ev as (
        insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, session_id)
        select id, 'edit', 'draft', 'draft', jsonb_build_object('field', 'media', 'from', from_id, 'to', to_id, 'fix', $1::text, 'via', 'touch-up keep fix'), $2::uuid
          from moved
        returning 1)
     select (select count(*) from f)::int as kept,
            (select count(*) from moved)::int as repointed,
            (select count(*) from ev)::int as events,
            (select count(*) from batch_items b join f on b.media_id = f.media_id where b.status not in ('draft','rejected'))::int as stayed`,
    [fixId, isUuid(sessionId) ? sessionId : null],
  );
  const r = rows[0] as { kept: number; repointed: number; stayed: number };
  if (r.kept !== 1) return { ok: false, reason: "this fix isn't ready to keep" };
  return { ok: true, repointed: r.repointed, stayed: r.stayed };
}

export interface KeepAllResult {
  /** Fixes kept. */
  kept: number;
  /** Still queued or running after this Keep all. */
  stillFixing: number;
  /** Clips Fix it can't change (shown in "Can't be fixed automatically"). */
  cantFix: number;
  /** Fixes that couldn't be kept (threw, or changed state meanwhile). */
  failed: number;
  /** Approved/queued/published posts left on the original, across all kept fixes. */
  stayed: number;
}

/**
 * "Keep all N fixes": every `done` fix, oldest first (at most 200), through the same `keepFix` rules, one
 * fix per statement/transaction so one failure never undoes the rest. Second call finds nothing: a no-op.
 */
export async function keepAllFixes(pool: Db, sessionId: string | null, now: Date = new Date()): Promise<KeepAllResult> {
  const { rows } = (await pool.query(
    `select id from media_fixes where status = 'done' and fixed_media_id is not null and requested_at <= $1 order by requested_at, id limit 200`,
    [now],
  )) as { rows: Array<{ id: string }> };
  const out: KeepAllResult = { kept: 0, stillFixing: 0, cantFix: 0, failed: 0, stayed: 0 };
  for (const r of rows) {
    try {
      const k = await keepFix(pool, r.id, sessionId);
      if (k.ok) {
        out.kept++;
        out.stayed += k.stayed;
      } else out.failed++;
    } catch {
      out.failed++;
    }
  }
  out.stillFixing = (await loadFixProgress(pool)).pending;
  out.cantFix = (await loadTouchUp(pool)).filter(isUnfixable).length;
  return out;
}

/** Flagged only by things Fix it can't change (and no fix yet): shown apart, never counted as "needs fixing". */
export const isUnfixable = (c: Pick<TouchUpClip, "fixOps" | "fix">): boolean => c.fix.state === "none" && c.fixOps.length === 0;

/** Older clips (before QA v2) the worker hasn't re-checked yet; same rule as the recheck job. */
export async function countUnchecked(pool: Db): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as n from media where r2_key like 'library/%' and (qa is null or qa->>'version' is distinct from '2')`,
  );
  return Number((rows[0] as { n: number }).n);
}

export interface FixProgress {
  /** Queued + running. */
  pending: number;
  /** Finished and waiting for a choice. */
  done: number;
}

export async function loadFixProgress(pool: Db): Promise<FixProgress> {
  const { rows } = await pool.query(
    `select count(*) filter (where status in ('queued','running'))::int as pending, count(*) filter (where status = 'done')::int as done from media_fixes where status in ('queued','running','done')`,
  );
  const r = rows[0] as FixProgress;
  return { pending: r.pending, done: r.done };
}

/** "Keep the original": the fix becomes 'discarded' (from done or failed). The fixed copy stays in storage and the DB, hidden. */
export async function keepOriginal(pool: Db, fixId: string): Promise<{ ok: boolean }> {
  if (!isUuid(fixId)) return { ok: false };
  const r = await pool.query(`update media_fixes set status = 'discarded', finished_at = coalesce(finished_at, now()) where id = $1 and status in ('done','failed') returning id`, [fixId]);
  return { ok: r.rows.length === 1 };
}

/** "Dismiss" one issue on one clip: it stops counting as flagged. Idempotent; never deletes (undone_at re-shows it). */
export async function dismissIssue(pool: Db, mediaId: string, code: string, sessionId: string | null): Promise<{ ok: boolean }> {
  if (!isUuid(mediaId) || !/^[a-z][a-z-]{1,40}$/.test(code)) return { ok: false };
  await pool.query(
    `insert into touchup_dismissals (media_id, code, session_id) select $1, $2, $3 where exists (select 1 from media where id = $1)
     on conflict (media_id, code) where undone_at is null do nothing`,
    [mediaId, code, isUuid(sessionId) ? sessionId : null],
  );
  return { ok: true };
}
