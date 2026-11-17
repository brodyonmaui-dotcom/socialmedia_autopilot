// Dev only (run 4): touch-up demo. Every demo clip gets a QA v2 result: most are clean, 12 carry info tags
// (2 of them legacy warning strings, read through the web's mapper), 6 have fixable issues and 1 is
// "mostly a still image" (not fixable). Fix states: one done (with before/after, a fixed media row
// `demo-fix-…` derived from it and a synthetic poster), one failed, one queued.
// Idempotent: qa is rewritten to the same value; fixes are added only where the clip has none; the fixed
// row is keyed on its content hash. Synthetic values only; nothing here touches a real file or posts anything.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { DEMO_HASH_PREFIX } from "./seed.js";
import { DEV_POSTER_DIR, syntheticPosterArgs } from "./seed-posters.js";

const execFileAsync = promisify(execFile);

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

type Issue = { code: string; severity: "fix" | "info"; fixable: boolean; detail: string; segments?: Array<{ start: number; end: number }> };

const NO_SOUND: Issue = { code: "no-sound", severity: "info", fixable: false, detail: "No sound yet." };
const LANDSCAPE: Issue = { code: "landscape", severity: "info", fixable: false, detail: "Landscape." };
const gaps = (d: number): Issue => ({ code: "silence-gaps", severity: "info", fixable: true, detail: "Has a silent pause in the middle. Fix it can cut it out, which changes the pacing.", segments: [{ start: d * 0.4, end: d * 0.4 + 2 }] });
const stillMiddle = (d: number): Issue => ({ code: "frozen-middle", severity: "info", fixable: false, detail: "Holds still for 6 seconds in the middle.", segments: [{ start: d * 0.3, end: d * 0.3 + 6 }] });
const frozenTail = (d: number): Issue => ({ code: "frozen-tail", severity: "fix", fixable: true, detail: "The last 3 seconds are a frozen frame. Fix it trims them off.", segments: [{ start: d - 3, end: d }] });
const BLACK_HEAD: Issue = { code: "black-head", severity: "fix", fixable: true, detail: "The first second is black. Fix it trims it off.", segments: [{ start: 0, end: 1 }] };
const QUIET: Issue = { code: "loudness", severity: "fix", fixable: true, detail: "The sound is much quieter than normal. Fix it raises it to the usual level." };
const FORMAT: Issue = { code: "format", severity: "fix", fixable: true, detail: "The video file is in a format that won't play well everywhere. Fix it converts it to a standard phone video." };
const ASPECT: Issue = { code: "aspect", severity: "fix", fixable: true, detail: "The video isn't full-screen tall. Fix it fills the sides with a blurred copy of the clip." };
const METADATA: Issue = { code: "metadata", severity: "fix", fixable: true, detail: "The file still carries phone or location details. Fix it removes them." };
const STILL: Issue = { code: "frozen-middle", severity: "fix", fixable: false, detail: "Mostly a still image. Re-export it." };

/** Clip index (by content hash order) → issues. Indices 2–8 are flagged; 0–1 and 9–18 carry info tags. */
function issuesFor(i: number, d: number): Issue[] | "legacy" {
  switch (i) {
    case 2: return [frozenTail(d), NO_SOUND];
    case 3: return [BLACK_HEAD, QUIET];
    case 4: return [QUIET];
    case 5: return [FORMAT];
    case 6: return [ASPECT];
    case 7: return [frozenTail(d), METADATA];
    case 8: return [STILL];
    case 0: case 1: return "legacy";
    case 9: case 10: case 11: case 12: return [NO_SOUND];
    case 13: case 14: return [LANDSCAPE];
    case 15: case 16: return [gaps(d)];
    case 17: return [stillMiddle(d)];
    case 18: return [NO_SOUND, gaps(d)];
    default: return [];
  }
}

const probeOf = (d: number, over: object = {}) => ({ width: 1080, height: 1920, fps: 30, durationS: d, hasAudio: true, hasLocationTags: false, videoCodec: "h264", audioCodec: "aac", pixFmt: "yuv420p", rotation: 0, ...over });

function qaV2(issues: Issue[], d: number, probeOver: object = {}) {
  return {
    version: 2,
    checkedAt: "2026-11-01T12:00:00.000Z",
    probe: probeOf(d, probeOver),
    blackSegments: issues.filter((x) => x.code.startsWith("black")).flatMap((x) => x.segments ?? []),
    frozenSegments: issues.filter((x) => x.code.startsWith("frozen")).flatMap((x) => x.segments ?? []),
    silenceSegments: issues.filter((x) => x.code === "silence-gaps").flatMap((x) => x.segments ?? []),
    loudness: issues.some((x) => x.code === "no-sound") ? undefined : { integratedLufs: issues.some((x) => x.code === "loudness") ? -31.5 : -14.2, truePeakDb: -2.1 },
    issues,
    warnings: issues.filter((x) => x.severity === "fix").map((x) => x.detail),
  };
}

const LEGACY = { warnings: ["3 frozen-frame segment(s)", "effectively silent (-61.0 LUFS)"] };
export const DEMO_FIX_HASH = `${DEMO_HASH_PREFIX}fix-0001`;

export async function seedTouchUp(db: Queryable, posterDir = DEV_POSTER_DIR): Promise<string> {
  const clips = (await db.query("select id, content_hash, source_path, duration_s, pillar from media where content_hash like $1 and content_hash not like $2 and derived_from is null order by content_hash", [`${DEMO_HASH_PREFIX}%`, `${DEMO_HASH_PREFIX}fix-%`])).rows as Array<{
    id: string;
    content_hash: string;
    source_path: string | null;
    duration_s: string | null;
    pillar: string | null;
  }>;
  if (clips.length < 19) return `touch-up demo skipped (need 19 demo clips, found ${clips.length})`;

  let flagged = 0;
  let tagged = 0;
  for (const [i, c] of clips.entries()) {
    const d = Math.max(8, Number(c.duration_s) || 20);
    const spec = issuesFor(i, d);
    const qa = spec === "legacy" ? LEGACY : qaV2(spec, d, i === 6 ? { height: 1350 } : i === 5 ? { videoCodec: "hevc" } : i === 13 || i === 14 ? { width: 1920, height: 1080 } : {});
    if (spec !== "legacy" && spec.some((x) => x.severity === "fix")) flagged++;
    else if (spec === "legacy" || spec.length) tagged++;
    await db.query("update media set qa = $2::jsonb, qa_checked_at = case when $3 then null else coalesce(qa_checked_at, now()) end where id = $1 and qa is distinct from $2::jsonb", [c.id, JSON.stringify(qa), spec === "legacy"]);
  }

  const noFix = async (mediaId: string) => (await db.query("select 1 from media_fixes where media_id = $1 limit 1", [mediaId])).rows.length === 0;
  const done = clips[2]!;
  const failed = clips[3]!;
  const queued = clips[7]!;
  const dDone = Math.max(8, Number(done.duration_s) || 20);

  // Done: a fixed copy (3 s shorter, clean) with its own synthetic poster.
  const posterKey = `demo/${DEMO_FIX_HASH}.jpg`;
  mkdirSync(join(posterDir, "demo"), { recursive: true });
  if (!existsSync(join(posterDir, posterKey))) await execFileAsync("ffmpeg", syntheticPosterArgs(99, join(posterDir, posterKey))).catch(() => undefined);
  const fixedPath = done.source_path ? done.source_path.replace(/(\.[^./\\]+)?$/, (ext) => `-fixed${ext || ".mp4"}`) : `demo/${DEMO_FIX_HASH}.mp4`;
  await db.query(
    `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status, qa, poster_key, derived_from, qa_checked_at)
     values ($1, $2, $3, $4, 1080, 1920, $5, 'ready', $6::jsonb, $7, $8, now())
     on conflict (content_hash) do nothing`,
    [DEMO_FIX_HASH, fixedPath, `demo/${DEMO_FIX_HASH}.mp4`, dDone - 3, done.pillar, JSON.stringify(qaV2([NO_SOUND], dDone - 3)), posterKey, done.id],
  );
  const fixedId = (await db.query("select id from media where content_hash = $1", [DEMO_FIX_HASH])).rows[0].id as string;
  let added = 0;
  if (await noFix(done.id)) {
    const stats = (s: number, size: number) => ({ durationS: s, loudnessLufs: null, videoCodec: "h264", width: 1080, height: 1920, sizeBytes: size });
    await db.query(
      `insert into media_fixes (media_id, ops, status, requested_at, started_at, finished_at, fixed_media_id, before, after)
       values ($1, '{trim,strip}', 'done', now() - interval '2 hours', now() - interval '2 hours', now() - interval '118 minutes', $2, $3::jsonb, $4::jsonb)`,
      [done.id, fixedId, JSON.stringify(stats(dDone, 18_400_000)), JSON.stringify(stats(dDone - 3, 15_600_000))],
    );
    added++;
  }
  if (await noFix(failed.id)) {
    await db.query(
      `insert into media_fixes (media_id, ops, status, requested_at, started_at, finished_at, error)
       values ($1, '{trim,loudness,strip}', 'failed', now() - interval '1 hour', now() - interval '1 hour', now() - interval '59 minutes', $2)`,
      [failed.id, "The fix took too long and was stopped. Nothing was changed."],
    );
    added++;
  }
  if (await noFix(queued.id)) {
    await db.query("insert into media_fixes (media_id, ops, status, requested_at) values ($1, '{trim,strip}', 'queued', now() - interval '3 minutes')", [queued.id]);
    added++;
  }
  return `touch-up demo: ${flagged} flagged, ${tagged} tagged, ${clips.length - flagged - tagged} clean, ${added} fix row(s) added (done/failed/queued)`;
}
