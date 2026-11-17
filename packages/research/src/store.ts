import type { Platform } from "@autopilot/core";
import { moveIdea, type MovePatch } from "./backlog.js";
import { isPillar, type Creator, type Hook, type Idea, type IdeaSource, type IdeaStage, type Pillar } from "./types.js";
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

// ---------- research that runs itself (0013): idea/hook cards, "Used" archive, run status ----------

/** An idea as the Ideas / Already used tabs show it. */
export interface IdeaCard extends Idea {
  source: IdeaSource;
  sourceKey: string | null;
  /** Link out to the reference post (creator ideas) or the anchor's source (scripts). */
  referenceUrl: string | null;
  /** What it's about (quotes at most the reference's hook line). */
  about: string;
  /** How to adapt it without copying ('' for his own scripts). */
  adapt: string;
  usedAt: string | null;
  pattern: string | null;
  score: number | null;
  notesBy: "code" | "ai" | "manual";
  /** @handle of the source creator, when there is one. */
  creatorHandle: string | null;
}

export interface HookCard extends Hook {
  sourceKey: string | null;
  referenceUrl: string | null;
  pattern: string | null;
  /** Fill-in structure ("Why does [thing] feel true until [moment]?"); '' when the hook is already his. */
  template: string;
  usedAt: string | null;
  creatorHandle: string | null;
}

function toIdeaCard(r: any): IdeaCard {
  return {
    ...toIdea(r),
    source: r.source ?? "manual",
    sourceKey: r.source_key ?? null,
    referenceUrl: r.reference_url ?? null,
    about: r.about ?? "",
    adapt: r.adapt ?? "",
    usedAt: iso(r.used_at),
    pattern: r.pattern ?? null,
    score: r.score == null ? null : Number(r.score),
    notesBy: r.notes_by ?? "code",
    creatorHandle: r.creator_handle ?? null,
  };
}
function toHookCard(r: any): HookCard {
  return {
    ...toHook(r),
    sourceKey: r.source_key ?? null,
    referenceUrl: r.reference_url ?? null,
    pattern: r.pattern ?? null,
    template: r.template ?? "",
    usedAt: iso(r.used_at),
    creatorHandle: r.creator_handle ?? null,
  };
}

export interface IdeaCardQuery {
  /** 'ideas' = not used yet (dropped ones hidden), 'used' = the "Already used" archive. */
  tab: "ideas" | "used";
  pillar?: Pillar | null;
  source?: IdeaSource | null;
  limit?: number;
}

/** Ideas tab: scripted first, then best score, then newest. Used tab: most recently used first. */
export async function listIdeaCards(pool: QueryPool, q: IdeaCardQuery): Promise<IdeaCard[]> {
  const where = [q.tab === "used" ? "i.used_at is not null" : "i.used_at is null and i.stage <> 'dropped'"];
  const params: unknown[] = [];
  if (q.pillar) {
    params.push(q.pillar);
    where.push(`i.pillar = $${params.length}`);
  }
  if (q.source) {
    params.push(q.source);
    where.push(`i.source = $${params.length}`);
  }
  params.push(Math.max(1, Math.min(q.limit ?? 200, 500)));
  const order = q.tab === "used" ? "i.used_at desc, i.created_at desc" : "(case i.source when 'creator' then 0 when 'niche' then 1 when 'manual' then 2 else 3 end), i.score desc nulls last, i.created_at desc, i.source_key";
  const { rows } = await pool.query(
    `select i.*, c.handle as creator_handle from ideas i left join creators c on c.id = i.source_creator_id
     where ${where.join(" and ")} order by ${order} limit $${params.length}`,
    params,
  );
  return rows.map(toIdeaCard);
}

/** The "Used" checkbox. Idempotent: a second tap keeps the first used_at. Returns null for an unknown id. */
export async function setIdeaUsed(pool: QueryPool, id: string, used: boolean): Promise<IdeaCard | null> {
  const { rows } = await pool.query(
    `update ideas set used_at = case when $2::boolean then coalesce(used_at, now()) else null end, updated_at = now()
     where id = $1 returning *, (select handle from creators where id = ideas.source_creator_id) as creator_handle`,
    [id, used],
  );
  return rows[0] ? toIdeaCard(rows[0]) : null;
}

export async function listHookCards(pool: QueryPool, q: { used?: boolean; pillar?: Pillar | null; limit?: number } = {}): Promise<HookCard[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.used !== undefined) where.push(q.used ? "h.used_at is not null" : "h.used_at is null");
  if (q.pillar) {
    params.push(q.pillar);
    where.push(`h.pillar = $${params.length}`);
  }
  params.push(Math.max(1, Math.min(q.limit ?? 200, 500)));
  const { rows } = await pool.query(
    `select h.*, c.handle as creator_handle from hooks h left join creators c on c.id = h.source_creator_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by h.used_at desc nulls first, h.times_used, h.created_at desc limit $${params.length}`,
    params,
  );
  return rows.map(toHookCard);
}

/** Marks a hook used (counts one use the first time) or back to unused. */
export async function setHookUsed(pool: QueryPool, id: string, used: boolean): Promise<HookCard | null> {
  const { rows } = await pool.query(
    `update hooks set
       times_used = case when $2::boolean and used_at is null then times_used + 1 else times_used end,
       used_at = case when $2::boolean then coalesce(used_at, now()) else null end
     where id = $1 returning *, (select handle from creators where id = hooks.source_creator_id) as creator_handle`,
    [id, used],
  );
  return rows[0] ? toHookCard(rows[0]) : null;
}

export interface ResearchRunRow {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  /** running | ok | partial | failed */
  status: string;
  creatorsChecked: number;
  ideasAdded: number;
  hooksAdded: number;
  /** One line per skipped creator / fallback (newline-separated). */
  note: string;
}

export function toResearchRun(r: any): ResearchRunRow {
  return {
    id: r.id,
    startedAt: iso(r.started_at)!,
    finishedAt: iso(r.finished_at),
    status: r.status,
    creatorsChecked: Number(r.creators_checked ?? 0),
    ideasAdded: Number(r.ideas_added ?? 0),
    hooksAdded: Number(r.hooks_added ?? 0),
    note: r.note ?? "",
  };
}

export async function lastResearchRun(pool: QueryPool): Promise<ResearchRunRow | null> {
  const { rows } = await pool.query("select * from research_runs order by started_at desc limit 1");
  return rows[0] ? toResearchRun(rows[0]) : null;
}

export interface ResearchCountsRow {
  /** Open ideas (not used, not dropped). */
  ideas: number;
  used: number;
  /** Unused hooks. */
  hooks: number;
  hooksUsed: number;
  creators: number;
  activeCreators: number;
  /** Open ideas per source. */
  bySource: Record<IdeaSource, number>;
}

export async function researchCounts(pool: QueryPool): Promise<ResearchCountsRow> {
  const { rows } = await pool.query(
    `select
       (select count(*)::int from ideas where used_at is null and stage <> 'dropped') as ideas,
       (select count(*)::int from ideas where used_at is not null) as used,
       (select count(*)::int from hooks where used_at is null) as hooks,
       (select count(*)::int from hooks where used_at is not null) as hooks_used,
       (select count(*)::int from creators) as creators,
       (select count(*)::int from creators where active) as active_creators,
       (select coalesce(json_object_agg(source, n), '{}'::json) from
          (select source, count(*)::int n from ideas where used_at is null and stage <> 'dropped' group by source) s) as by_source`,
  );
  const r = rows[0] ?? {};
  const by = (r.by_source ?? {}) as Partial<Record<IdeaSource, number>>;
  return {
    ideas: r.ideas ?? 0,
    used: r.used ?? 0,
    hooks: r.hooks ?? 0,
    hooksUsed: r.hooks_used ?? 0,
    creators: r.creators ?? 0,
    activeCreators: r.active_creators ?? 0,
    bySource: { manual: by.manual ?? 0, creator: by.creator ?? 0, niche: by.niche ?? 0, script: by.script ?? 0 },
  };
}

export async function aiTokensThisMonth(pool: QueryPool, purpose: string, now = new Date()): Promise<number> {
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const { rows } = await pool.query("select input_tokens, output_tokens from ai_token_usage where month = $1 and purpose = $2", [month, purpose]);
  return rows[0] ? Number(rows[0].input_tokens) + Number(rows[0].output_tokens) : 0;
}
