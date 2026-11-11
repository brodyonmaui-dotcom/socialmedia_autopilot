import type { Platform } from "@autopilot/core";
import { moveIdea, type MovePatch } from "./backlog.js";
import { isPillar, type Creator, type Hook, type Idea, type IdeaStage, type Pillar } from "./types.js";
import { lintText } from "./voice-lint.js";

/** The slice of pg.Pool this needs (same pattern as packages/db settings.ts), so tests pass a fake. */
export interface QueryPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const PLATFORMS: readonly Platform[] = ["instagram", "youtube", "tiktok", "snapchat"];

export function normalizeHandle(raw: string): string {
  let h = raw.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (/^https?:\/\//i.test(h)) h = h.split("/").pop() ?? "";
  h = h.replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9._-]{1,40}$/.test(h)) throw new ValidationError("handle: letters, numbers, . _ - only");
  return h;
}

/** Research text never names a place or real-time whereabouts. */
function assertNoPlace(field: string, text: string, blocklist?: string[]): void {
  const bad = lintText({ text, kind: "hook", blocklist }).issues.find((i) => i.rule.startsWith("privacy."));
  if (bad) throw new ValidationError(`${field}: ${bad.message}`);
}

export interface NewCreator {
  platform: string;
  handle: string;
  pillar?: string | null;
  notes?: string;
  followers?: number | null;
}

export function validateCreator(input: NewCreator, blocklist?: string[]): Omit<Creator, "id" | "createdAt" | "lastCheckedAt" | "active"> {
  if (!PLATFORMS.includes(input.platform as Platform)) throw new ValidationError("platform: unknown");
  const pillar = input.pillar ? (isPillar(input.pillar) ? input.pillar : null) : null;
  if (input.pillar && !pillar) throw new ValidationError("pillar: unknown");
  const notes = (input.notes ?? "").trim().slice(0, 500);
  assertNoPlace("notes", notes, blocklist);
  const followers = input.followers ?? null;
  if (followers !== null && (!Number.isInteger(followers) || followers < 0)) throw new ValidationError("followers: whole number");
  return { platform: input.platform as Platform, handle: normalizeHandle(input.handle), pillar, notes, followers };
}

export interface NewIdea {
  title: string;
  pillar?: string | null;
  hook?: string;
  sourceCreatorId?: string | null;
}

export function validateIdea(input: NewIdea, blocklist?: string[]): Pick<Idea, "title" | "pillar" | "hook" | "sourceCreatorId"> {
  const title = input.title.trim().slice(0, 140);
  if (!title) throw new ValidationError("title: required");
  const hook = (input.hook ?? "").trim().slice(0, 200);
  assertNoPlace("title", title, blocklist);
  assertNoPlace("hook", hook, blocklist);
  const pillar = input.pillar ? (isPillar(input.pillar) ? input.pillar : null) : null;
  if (input.pillar && !pillar) throw new ValidationError("pillar: unknown");
  return { title, pillar, hook, sourceCreatorId: input.sourceCreatorId || null };
}

export interface NewHook {
  text: string;
  pillar?: string | null;
  source?: "own" | "creator";
  sourceCreatorId?: string | null;
}

export function validateHook(input: NewHook, blocklist?: string[]): Pick<Hook, "text" | "pillar" | "source" | "sourceCreatorId"> {
  const text = input.text.trim().slice(0, 200);
  if (!text) throw new ValidationError("text: required");
  assertNoPlace("hook", text, blocklist);
  const pillar = input.pillar ? (isPillar(input.pillar) ? input.pillar : null) : null;
  return { text, pillar, source: input.source === "creator" ? "creator" : "own", sourceCreatorId: input.sourceCreatorId || null };
}

// ---------- row mapping ----------
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

function toCreator(r: any): Creator {
  return {
    id: r.id,
    platform: r.platform,
    handle: r.handle,
    pillar: r.pillar,
    notes: r.notes,
    followers: r.followers,
    active: r.active,
    lastCheckedAt: iso(r.last_checked_at),
    createdAt: iso(r.created_at)!,
  };
}
function toIdea(r: any): Idea {
  return {
    id: r.id,
    title: r.title,
    pillar: r.pillar,
    stage: r.stage,
    hook: r.hook,
    script: r.script,
    sourceCreatorId: r.source_creator_id,
    mediaId: r.media_id,
    batchItemIds: r.batch_item_ids ?? [],
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}
function toHook(r: any): Hook {
  return {
    id: r.id,
    text: r.text,
    pillar: r.pillar,
    source: r.source,
    sourceCreatorId: r.source_creator_id,
    timesUsed: r.times_used,
    createdAt: iso(r.created_at)!,
  };
}

// ---------- queries ----------
export async function listCreators(pool: QueryPool): Promise<Creator[]> {
  const { rows } = await pool.query("select * from creators order by active desc, platform, handle");
  return rows.map(toCreator);
}

export async function addCreator(pool: QueryPool, input: NewCreator, blocklist?: string[]): Promise<Creator> {
  const c = validateCreator(input, blocklist);
  const { rows } = await pool.query(
    `insert into creators (platform, handle, pillar, notes, followers) values ($1, $2, $3, $4, $5)
     on conflict (platform, handle) do update set pillar = excluded.pillar, notes = excluded.notes,
       followers = coalesce(excluded.followers, creators.followers), active = true
     returning *`,
    [c.platform, c.handle, c.pillar, c.notes, c.followers],
  );
  return toCreator(rows[0]);
}

export async function setCreatorActive(pool: QueryPool, id: string, active: boolean): Promise<void> {
  await pool.query("update creators set active = $2 where id = $1", [id, active]);
}

export async function listIdeas(pool: QueryPool, stage?: IdeaStage): Promise<Idea[]> {
  const { rows } = stage
    ? await pool.query("select * from ideas where stage = $1 order by created_at", [stage])
    : await pool.query("select * from ideas order by created_at");
  return rows.map(toIdea);
}

export async function addIdea(pool: QueryPool, input: NewIdea, blocklist?: string[]): Promise<Idea> {
  const i = validateIdea(input, blocklist);
  const { rows } = await pool.query(
    "insert into ideas (title, pillar, hook, source_creator_id) values ($1, $2, $3, $4) returning *",
    [i.title, i.pillar, i.hook, i.sourceCreatorId],
  );
  return toIdea(rows[0]);
}

/** Loads, validates the move with moveIdea (so DB and UI share one rule set), then writes. */
export async function moveIdeaById(pool: QueryPool, id: string, to: IdeaStage, patch: MovePatch = {}, blocklist?: string[]): Promise<Idea> {
  const { rows } = await pool.query("select * from ideas where id = $1", [id]);
  if (!rows[0]) throw new ValidationError("idea not found");
  if (patch.script) assertNoPlace("script", patch.script, blocklist);
  if (patch.hook) assertNoPlace("hook", patch.hook, blocklist);
  const next = moveIdea(toIdea(rows[0]), to, patch);
  // The stage guard in WHERE makes a double-tap from the phone a no-op instead of a second move.
  const res = await pool.query(
    `update ideas set stage = $2, script = $3, hook = $4, media_id = $5, batch_item_ids = $6, updated_at = now()
     where id = $1 and stage = $7 returning *`,
    [id, next.stage, next.script, next.hook, next.mediaId, next.batchItemIds, rows[0].stage],
  );
  if (!res.rows[0]) throw new ValidationError("idea changed meanwhile; reload");
  return toIdea(res.rows[0]);
}

export async function listHooks(pool: QueryPool, pillar?: Pillar): Promise<Hook[]> {
  const { rows } = pillar
    ? await pool.query("select * from hooks where pillar = $1 order by times_used, created_at desc", [pillar])
    : await pool.query("select * from hooks order by times_used, created_at desc");
  return rows.map(toHook);
}

export async function addHook(pool: QueryPool, input: NewHook, blocklist?: string[]): Promise<Hook> {
  const h = validateHook(input, blocklist);
  const { rows } = await pool.query(
    "insert into hooks (text, pillar, source, source_creator_id) values ($1, $2, $3, $4) returning *",
    [h.text, h.pillar, h.source, h.sourceCreatorId],
  );
  return toHook(rows[0]);
}
