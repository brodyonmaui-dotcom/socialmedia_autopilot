/**
 * Studio data layer (server only, F24). Loaders for the editor (library-eligible clips, sounds), the render request
 * (validated with the worker's own parseEdl + DB checks + the caption lint's privacy rules, then ONE queued
 * media_edits row of kind 'studio', no migration) and the status poll (scoped to studio rows and the asked ids).
 * Nothing here publishes or approves: the worker adds a library clip, the creator approves it in Ready to post.
 */
import type { Pool } from "pg";
import { EDL_LIMITS, parseEdl, type Edl } from "@autopilot/media/src/edl.js";
import { lintText } from "@autopilot/research";
import { mediaLabel } from "../batches/pg-store.js";
import { hasFolderColumn, isUuid } from "../library/data.js";
import { listSounds, type SoundRow } from "../reels/data.js";

export type Db = Pick<Pool, "query">;

/** Media rows the library hides (same predicate as lib/library/data.ts HIDDEN). */
const HIDDEN = `(
  exists (select 1 from media_fixes hf where hf.fixed_media_id = m.id and hf.status in ('queued','running','done','discarded','failed'))
  or exists (select 1 from media_fixes hk where hk.media_id = m.id and hk.status = 'kept')
)`;
/** A clip Studio may use: visible in the library, not archived, with a clean file in storage. */
const ELIGIBLE = `m.status <> 'archived' and coalesce(m.r2_key, '') <> '' and not ${HIDDEN}`;

/** The edit JSON is small (≤ 10 clips + 10 texts); anything bigger is refused unread. */
export const STUDIO_EDL_MAX_BYTES = 32_000;
export const STUDIO_STATUS_MAX_IDS = 50;
const CLIPS_LIMIT = 500;

const posterUrl = (id: string) => `/app/media/poster/${encodeURIComponent(id)}`;
const durationOf = (r: { duration_s: unknown; qa: { probe?: { durationS?: unknown } } | null }) => {
  const d = r.duration_s == null ? Number(r.qa?.probe?.durationS ?? NaN) : Number(r.duration_s);
  return Number.isFinite(d) && d > 0 ? d : null;
};

// ---------- Loaders ----------

export interface StudioClip {
  mediaId: string;
  name: string;
  folder: string | null;
  durationS: number | null;
  posterUrl: string | null;
  hasAudio: boolean;
}

/** Library-eligible clips, newest first (folder only when migration 0016 is applied). */
export async function loadStudioClips(pool: Db): Promise<StudioClip[]> {
  const folders = await hasFolderColumn(pool);
  const { rows } = await pool.query(
    `select m.id, m.source_path, m.duration_s, m.qa, m.poster_key, ${folders ? "m.folder" : "null::text as folder"}
       from media m where ${ELIGIBLE}
      order by m.created_at desc, m.id desc limit ${CLIPS_LIMIT}`,
  );
  return rows.map((r) => ({
    mediaId: String(r.id),
    name: mediaLabel(r.source_path, String(r.id)),
    folder: r.folder ?? null,
    durationS: durationOf(r),
    posterUrl: r.poster_key ? posterUrl(String(r.id)) : null,
    hasAudio: r.qa?.probe?.hasAudio !== false,
  }));
}

/** The sound picker (lib/reels listSounds: not archived, newest first). */
export async function loadSounds(pool: Db): Promise<SoundRow[]> {
  return listSounds(pool);
}

// ---------- Render request ----------

/** Text-overlay checks: the caption lint's privacy rules (places, real-time whereabouts, pins, PRIVACY_BLOCKLIST). Pure. */
export function studioTextProblems(text: string, blocklist: string[]): string[] {
  const res = lintText({ text, kind: "hook", blocklist });
  return res.issues.filter((i) => i.severity === "error" && i.rule.startsWith("privacy.")).map((i) => i.message);
}

export type StudioRequestResult = { ok: true; editId: string } | { ok: false; error: string };

/**
 * Validates and queues one Studio render. Every rule the worker applies is checked first (parseEdl), plus: each clip
 * exists and is library-eligible, its out point is inside the clip, the sound exists and isn't archived, and no text
 * names a place. `source_media_id` = the first clip; the EDL is stored as params.
 */
export async function requestStudioRender(pool: Db, edlJson: unknown, ctx: { blocklist: string[] }): Promise<StudioRequestResult> {
  if (typeof edlJson !== "string" || edlJson.length > STUDIO_EDL_MAX_BYTES) return { ok: false, error: "The edit couldn't be read. Reload Studio and try again." };
  const parsed = parseEdl(edlJson);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const edl: Edl = parsed.edl;

  const ids = [...new Set(edl.clips.map((c) => c.mediaId))];
  const { rows } = await pool.query(`select m.id, m.duration_s, m.qa from media m where m.id = any($1::uuid[]) and ${ELIGIBLE}`, [ids]);
  const dur = new Map(rows.map((r) => [String(r.id), durationOf(r)]));
  for (const [i, c] of edl.clips.entries()) {
    if (!dur.has(c.mediaId)) return { ok: false, error: `Clip ${i + 1} isn't in the library any more. Remove it and try again.` };
    const d = dur.get(c.mediaId);
    if (d != null && c.outS > d + 0.05) return { ok: false, error: `Clip ${i + 1}'s out point is past the end of the clip.` };
  }
  if (edl.sound) {
    const s = (await pool.query(`select id from sounds where id = $1 and archived_at is null`, [edl.sound.soundId])).rows[0];
    if (!s) return { ok: false, error: "That sound isn't available any more. Pick another one." };
  }
  for (const [i, t] of edl.texts.entries()) {
    const problems = studioTextProblems(t.text, ctx.blocklist);
    if (problems.length) return { ok: false, error: `Text ${i + 1}: ${problems.join("; ")}. Texts never name places.` };
  }
  const ins = await pool.query(`insert into media_edits (kind, source_media_id, sound_id, params, caption) values ('studio', $1, $2, $3::jsonb, '') returning id`, [
    edl.clips[0]!.mediaId,
    edl.sound?.soundId ?? null,
    JSON.stringify(edl),
  ]);
  return { ok: true, editId: String(ins.rows[0].id) };
}

export { EDL_LIMITS };

// ---------- Status ----------

export interface StudioStatusView {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  resultMediaId?: string;
  posterUrl?: string;
  error?: string;
}

/** Status of exactly the studio rows these ids name (never a reel, never anything else), in the order asked. */
export async function studioStatuses(pool: Db, ids: string[]): Promise<StudioStatusView[]> {
  const want = [...new Set(ids.map((s) => s.toLowerCase()))].filter(isUuid);
  if (!want.length) return [];
  const { rows } = await pool.query(
    `select e.id, e.status, e.result_media_id, e.error, m.poster_key
       from media_edits e left join media m on m.id = e.result_media_id
      where e.kind = 'studio' and e.id = any($1::uuid[])`,
    [want],
  );
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  return want.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    const v: StudioStatusView = { id, status: r.status };
    if (r.result_media_id) v.resultMediaId = String(r.result_media_id);
    if (r.result_media_id && r.poster_key) v.posterUrl = posterUrl(String(r.result_media_id));
    if (r.status === "failed") v.error = r.error ?? "Something went wrong.";
    return [v];
  });
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" } });

/** GET ?ids=a,b → 200 [StudioStatusView] (400 on a bad or too-long id list). */
export async function handleStudioStatus(pool: Db, url: string): Promise<Response> {
  const raw = new URL(url, "http://local").searchParams.get("ids") ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length > STUDIO_STATUS_MAX_IDS || ids.some((id) => !isUuid(id))) return json(400, { error: "Bad edit ids." });
  return json(200, await studioStatuses(pool, ids));
}
