/**
 * Reel maker data layer (server only, F20 E). Sounds: list, add (bytes go to R2 `sounds/<sha256>.<ext>`
 * through an injected put, so tests need no storage), archive (sets archived_at; nothing is ever deleted).
 * Reels: requestReel validates with the worker's own rules (planReel) and the calendar's caption lint, then
 * inserts one queued media_edits row; the worker (apps/worker media-reel) does the ffmpeg work and adds a
 * DRAFT Instagram item. Nothing here publishes or approves.
 */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { addCalendarDays, localClock12, localDate, weekdayIndex } from "@autopilot/core";
import { planReel, REEL_LIMITS, isReelAudio, type ReelAudio, type ReelParams } from "@autopilot/media/src/reel-plan.js";
import { isPillar, lintText } from "@autopilot/research";
import { mediaLabel } from "../batches/pg-store.js";
import { batchRedirect } from "../calendar/model.js";

export type Db = Pick<Pool, "query">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

// ---------- Sounds ----------

export const SOUND_MAX_BYTES = 15 * 1024 * 1024;
export const SOUND_EXTS = ["mp3", "m4a", "wav"] as const;
export type SoundExt = (typeof SOUND_EXTS)[number];
export const SOUND_CONTENT_TYPE: Record<SoundExt, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav" };
export const SOUND_RIGHTS_NOTE = "Only use audio you own or that's royalty-free: Instagram labels it as original audio.";

export interface SoundRow {
  id: string;
  name: string;
  durationS: number | null;
  createdAt: string;
  archived: boolean;
}

export async function listSounds(pool: Db, opts: { includeArchived?: boolean } = {}): Promise<SoundRow[]> {
  const { rows } = await pool.query(
    `select id, name, duration_s, created_at, archived_at from sounds ${opts.includeArchived ? "" : "where archived_at is null"} order by archived_at nulls first, created_at desc, id desc limit 200`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    durationS: r.duration_s == null ? null : Number(r.duration_s),
    createdAt: new Date(r.created_at).toISOString(),
    archived: r.archived_at != null,
  }));
}

/** The file's own bytes must match its extension (a renamed file is refused). */
export function sniffSound(bytes: Uint8Array): SoundExt | null {
  const at = (i: number, s: string) => [...s].every((c, k) => bytes[i + k] === c.charCodeAt(0));
  if (bytes.length >= 12 && at(0, "RIFF") && at(8, "WAVE")) return "wav";
  if (bytes.length >= 12 && at(4, "ftyp")) return "m4a";
  if (bytes.length >= 3 && at(0, "ID3")) return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "mp3";
  return null;
}

export type AddSoundResult = { ok: true; id: string; already: boolean } | { ok: false; reason: string };

/**
 * Validates (mp3/m4a/wav by extension AND content, 1 byte–15 MB), uploads to `sounds/<sha256>.<ext>` and
 * inserts the row. The same file twice is one row (r2_key is unique); re-adding an archived one un-archives it.
 */
export async function addSound(
  pool: Db,
  input: { fileName: string; bytes: Uint8Array; name?: string | null },
  put: ((key: string, body: Uint8Array, contentType: string) => Promise<void>) | null,
): Promise<AddSoundResult> {
  const ext = (/\.([a-z0-9]+)$/i.exec(input.fileName.trim())?.[1] ?? "").toLowerCase();
  if (!(SOUND_EXTS as readonly string[]).includes(ext)) return { ok: false, reason: "Pick an mp3, m4a or wav file." };
  if (input.bytes.byteLength === 0) return { ok: false, reason: "That file is empty." };
  if (input.bytes.byteLength > SOUND_MAX_BYTES) return { ok: false, reason: "That file is over 15 MB." };
  if (sniffSound(input.bytes) !== ext) return { ok: false, reason: `That file isn't a real ${ext} file.` };
  if (!put) return { ok: false, reason: "Storage (R2) isn't set up on the dashboard, so sounds can't be uploaded yet." };
  const hash = createHash("sha256").update(input.bytes).digest("hex");
  const key = `sounds/${hash}.${ext}`;
  const stem = input.fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const name = (input.name?.trim() || stem || "Sound").replace(/\s+/g, " ").slice(0, 80);
  const prior = (await pool.query(`select id from sounds where r2_key = $1`, [key])).rows[0];
  if (prior) {
    await pool.query(`update sounds set archived_at = null where id = $1`, [prior.id]);
    return { ok: true, id: String(prior.id), already: true };
  }
  await put(key, input.bytes, SOUND_CONTENT_TYPE[ext as SoundExt]);
  const ins = await pool.query(
    `insert into sounds (name, r2_key) values ($1, $2) on conflict (r2_key) do update set archived_at = null returning id`,
    [name, key],
  );
  return { ok: true, id: String(ins.rows[0].id), already: false };
}

/** Archive hides a sound from the picker. The file stays in storage; reels already made keep working. */
export async function archiveSound(pool: Db, id: string): Promise<{ ok: boolean }> {
  if (!isUuid(id)) return { ok: false };
  const r = await pool.query(`update sounds set archived_at = now() where id = $1 and archived_at is null returning id`, [id]);
  return { ok: (r.rows?.length ?? 0) === 1 };
}

// ---------- Make a reel ----------

export interface ReelSource {
  mediaId: string;
  label: string;
  durationS: number | null;
  pillar: string | null;
  hasAudio: boolean;
  hasPoster: boolean;
}

/** The clip the form is for, or null when it can't be used (unknown, archived, or no clean file). */
export async function loadReelSource(pool: Db, mediaId: string): Promise<ReelSource | null> {
  if (!isUuid(mediaId)) return null;
  const r = (await pool.query(`select id, source_path, duration_s, pillar, qa, poster_key from media where id = $1 and status <> 'archived' and r2_key is not null`, [mediaId])).rows[0];
  if (!r) return null;
  const d = r.duration_s == null ? Number(r.qa?.probe?.durationS ?? NaN) : Number(r.duration_s);
  return {
    mediaId: String(r.id),
    label: mediaLabel(r.source_path, r.id),
    durationS: Number.isFinite(d) ? d : null,
    pillar: r.pillar ?? null,
    hasAudio: r.qa?.probe?.hasAudio !== false,
    hasPoster: !!r.poster_key,
  };
}

export interface ReelRequest {
  mediaId: string;
  soundId: string | null;
  audio: string;
  trimStartS: number | null;
  trimEndS: number | null;
  soundVolume: number | null;
  originalVolume: number | null;
  caption: string;
}

export type RequestReelResult = { ok: true; editId: string } | { ok: false; reason: string };

/** Instagram's caption limit. */
export const CAPTION_MAX = 2200;

/** Caption checks the calendar runs (lintText errors block; the IG ≤ 5 hashtag rule is one of them). Pure. */
export function reelCaptionProblems(caption: string, pillar: string | null, blocklist: string[]): string[] {
  const text = caption.trim();
  if (!text) return ["needs a caption"];
  if ([...text].length > CAPTION_MAX) return [`caption over ${CAPTION_MAX} characters`];
  const res = lintText({ text, kind: "caption", platform: "instagram", pillar: isPillar(pillar) ? pillar : null, blocklist });
  const out = res.issues.filter((i) => i.severity === "error").map((i) => i.message);
  if (/\{\{[^}]*\}\}/.test(text) && !out.some((m) => /placeholder/.test(m))) out.push("fill in the {{…}} placeholder");
  return out;
}

/** Validates and queues one reel. Every rule the worker applies is checked here first, so a queued reel should render. */
export async function requestReel(pool: Db, req: ReelRequest, ctx: { blocklist: string[] }): Promise<RequestReelResult> {
  if ([req.trimStartS, req.trimEndS, req.soundVolume, req.originalVolume].some((n) => n !== null && !Number.isFinite(n))) {
    return { ok: false, reason: "Times and volumes must be plain numbers (or left blank)." };
  }
  const src = await loadReelSource(pool, req.mediaId);
  if (!src) return { ok: false, reason: "That clip can't be used for a reel." };
  if (!isReelAudio(req.audio)) return { ok: false, reason: "Pick how the sound is used." };
  const audio: ReelAudio = req.audio;
  let soundId: string | null = null;
  if (audio !== "original") {
    if (!isUuid(req.soundId)) return { ok: false, reason: "Pick a sound (or keep the clip's own sound)." };
    const s = (await pool.query(`select id from sounds where id = $1 and archived_at is null`, [req.soundId])).rows[0];
    if (!s) return { ok: false, reason: "That sound isn't available any more." };
    soundId = String(s.id);
  }
  const plan = planReel({
    durationS: src.durationS ?? 0,
    trimStartS: req.trimStartS,
    trimEndS: req.trimEndS,
    audio,
    soundVolume: req.soundVolume,
    originalVolume: req.originalVolume,
    sourceHasAudio: src.hasAudio,
  });
  if (plan.refusal) return { ok: false, reason: plan.refusal };
  const problems = reelCaptionProblems(req.caption, src.pillar, ctx.blocklist);
  if (problems.length) return { ok: false, reason: `Caption: ${problems.join("; ")}.` };

  const params: ReelParams = {
    trimStartS: req.trimStartS,
    trimEndS: req.trimEndS,
    audio,
    soundVolume: audio === "original" ? null : plan.soundVolume,
    originalVolume: audio === "sound" ? null : plan.originalVolume,
  };
  const ins = await pool.query(
    `insert into media_edits (kind, source_media_id, sound_id, params, caption) values ('reel', $1, $2, $3::jsonb, $4) returning id`,
    [src.mediaId, soundId, JSON.stringify(params), req.caption.trim()],
  );
  return { ok: true, editId: String(ins.rows[0].id) };
}

/** Form fields → a ReelRequest (numbers parsed; blanks become null). Pure. */
export function reelRequestFromForm(fd: FormData): ReelRequest {
  const s = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const n = (k: string) => {
    const v = s(k);
    if (v === "") return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : NaN;
  };
  const sound = s("soundId");
  return {
    mediaId: s("mediaId"),
    soundId: sound === "" || sound === "original" ? null : sound,
    audio: sound === "original" ? "original" : s("audio"),
    trimStartS: n("trimStartS"),
    trimEndS: n("trimEndS"),
    soundVolume: n("soundVolume"),
    originalVolume: n("originalVolume"),
    caption: typeof fd.get("caption") === "string" ? String(fd.get("caption")) : "",
  };
}

export { REEL_LIMITS };

// ---------- Reels list ----------

export interface ReelView {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  label: string;
  /** "Nov 22, 3:05 PM" (creator zone, 12-hour). */
  requested: string;
  error: string | null;
  /** When done: the calendar day (or week, untimed) holding the draft item. */
  calendarHref: string | null;
  /** When done and timed: "Tue Nov 24, 6:00 PM". */
  postAt: string | null;
  resultMediaId: string | null;
}

const dayLabel = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(d);
const weekdayLabel = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(d);

export async function listReels(pool: Db, timeZone: string, limit = 30): Promise<ReelView[]> {
  const { rows } = await pool.query(
    `select e.id, e.status, e.error, e.requested_at, e.result_media_id, m.source_path, m.id as media_id, bi.scheduled_for, b.week_start::text as week_start
       from media_edits e
       join media m on m.id = e.source_media_id
       left join batch_items bi on bi.id = e.batch_item_id
       left join batches b on b.id = bi.batch_id
      where e.kind = 'reel'
      order by e.requested_at desc, e.id desc
      limit $1`,
    [limit],
  );
  return rows.map((r) => {
    const req = new Date(r.requested_at);
    const at = r.scheduled_for == null ? null : new Date(r.scheduled_for);
    let calendarHref: string | null = null;
    if (r.status === "done" && at) {
      const day = localDate(at, timeZone);
      calendarHref = `/calendar?view=week&d=${day}&day=${day}`;
    } else if (r.status === "done" && r.week_start) {
      const ws = String(r.week_start).slice(0, 10);
      calendarHref = batchRedirect(addCalendarDays(ws, -weekdayIndex(ws)));
    }
    return {
      id: String(r.id),
      status: r.status,
      label: mediaLabel(r.source_path, r.media_id),
      requested: `${dayLabel(req, timeZone)}, ${localClock12(req, timeZone)}`,
      error: r.status === "failed" ? (r.error ?? "Something went wrong.") : null,
      calendarHref,
      postAt: at ? `${weekdayLabel(at, timeZone)}, ${localClock12(at, timeZone)}` : null,
      resultMediaId: r.result_media_id ?? null,
    };
  });
}
