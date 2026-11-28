import type { Platform } from "./types.js";
import { localDate, weekdayIndex } from "./time.js";
import { fingerprintsMatch, parseFingerprint, type Fingerprint } from "./video-fingerprint.js";

/**
 * Duplicate guard v2 (F26 A). Instagram only recommends the original of identical content, so the same VIDEO on the
 * same platform twice is blocked, whatever its media row. "Same video" is any of:
 *  1. lineage: the two rows share an ancestor through `media.derived_from` (and, for Studio, every clip of the edit)
 *     with no new edits on the way: touch-up fixes, reel-maker and Studio outputs without ≥ 3 s of new edits;
 *  2. fingerprint: media.fingerprint matches (see video-fingerprint.ts): a re-upload with a new content_hash;
 *  3. name: the same basename of source_path and durations within 0.5 s.
 * A reel/Studio output with ≥ 3 s of new edits (text, a different trim, a new sound) relates to its source as
 * "derived": warn only ("Uses footage you posted on …"); on Instagram also flagged as not fit for a trial reel.
 *
 * Rule (same platform): a same-video item scheduled or published within 90 days of this one → block; older → warn.
 * Items rejected as "already posted" count as published at their scheduled time; failed and plain-rejected items
 * don't count. The db side (`recentVideoUse` in @autopilot/db) loads the rows; everything here is pure.
 */
export const VIDEO_REPEAT = { blockDays: 90, nameDurationS: 0.5, newEditS: 3 } as const;

const DAY_MS = 86_400_000;

export type VideoRelation = "same" | "derived";
export type VideoMatchWhy = "same-clip" | "lineage" | "fingerprint" | "name";

/** One media row as the guard sees it. */
export interface VideoIdentity {
  id: string;
  derivedFrom: string | null;
  /** Extra parents (a Studio edit's other clips). */
  parents?: readonly string[];
  fingerprint: string | null;
  sourcePath: string | null;
  durationS: number | null;
  /** This row is an edit output (reel / Studio) with ≥ 3 s of new edits over its parents. */
  newEdits: boolean;
}

export interface VideoIndex {
  byId: Map<string, VideoIdentity>;
  /** Parsed fingerprints, sorted by duration (for the ±1 s window). */
  fps: Array<{ id: string; fp: Fingerprint }>;
  /** Lower-cased basename → ids. */
  byName: Map<string, string[]>;
  /** id → ancestor → "an edit with new footage lies on the way" (memoised). Self is in it with false. */
  anc: Map<string, Map<string, boolean>>;
  /** id → every id connected to it by lineage edges (its component, self included). */
  group: Map<string, string[]>;
}

/** The file name of a stored source_path (laptop path, upload basename, "<stem>-reel.mp4"). Lower-cased; "" when none. */
export function sourceBasename(p: string | null | undefined): string {
  return (p ?? "").split(/[\\/]/).pop()?.trim().toLowerCase() ?? "";
}

export function buildVideoIndex(rows: readonly VideoIdentity[]): VideoIndex {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const fps: VideoIndex["fps"] = [];
  const byName = new Map<string, string[]>();
  for (const r of rows) {
    const fp = parseFingerprint(r.fingerprint);
    if (fp) fps.push({ id: r.id, fp });
    const n = sourceBasename(r.sourcePath);
    if (n) (byName.get(n) ?? byName.set(n, []).get(n)!).push(r.id);
  }
  fps.sort((a, b) => a.fp.durationS - b.fp.durationS);
  // Union-find over lineage edges, so a family lookup only walks its own component.
  const up = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (up.has(r) && up.get(r) !== r) r = up.get(r)!;
    let c = x;
    while (c !== r) {
      const n = up.get(c)!;
      up.set(c, r);
      c = n;
    }
    return r;
  };
  for (const r of rows) {
    if (!up.has(r.id)) up.set(r.id, r.id);
    for (const p of [...(r.derivedFrom ? [r.derivedFrom] : []), ...(r.parents ?? [])]) {
      if (!byId.has(p)) continue;
      if (!up.has(p)) up.set(p, p);
      const a = find(r.id);
      const b = find(p);
      if (a !== b) up.set(a, b);
    }
  }
  const members = new Map<string, string[]>();
  for (const r of rows) {
    const k = find(r.id);
    (members.get(k) ?? members.set(k, []).get(k)!).push(r.id);
  }
  const group = new Map<string, string[]>();
  for (const list of members.values()) for (const id of list) group.set(id, list);
  return { byId, fps, byName, anc: new Map(), group };
}

/** Ancestors of `id` (self included), each with whether an edit with new footage lies between it and `id`. */
function ancestors(ix: VideoIndex, id: string, seen: Set<string> = new Set()): Map<string, boolean> {
  const memo = ix.anc.get(id);
  if (memo) return memo;
  const out = new Map<string, boolean>([[id, false]]);
  const row = ix.byId.get(id);
  if (row && !seen.has(id)) {
    seen.add(id);
    const parents = new Set([...(row.derivedFrom ? [row.derivedFrom] : []), ...(row.parents ?? [])]);
    parents.delete(id);
    for (const p of parents) {
      for (const [a, edited] of ancestors(ix, p, seen)) {
        const e = edited || row.newEdits;
        // Two paths to one ancestor: the plain one wins (it is the stronger "same video").
        const prev = out.get(a);
        out.set(a, prev === undefined ? e : prev && e);
      }
    }
    seen.delete(id);
  }
  if (seen.size === 0) ix.anc.set(id, out);
  return out;
}

/** How `a` relates to `b`, or null when they are different videos. Symmetric. */
export function videoRelation(ix: VideoIndex, a: string, b: string): { relation: VideoRelation; why: VideoMatchWhy } | null {
  if (a === b) return { relation: "same", why: "same-clip" };
  const aa = ancestors(ix, a);
  const ab = ancestors(ix, b);
  let lineage: VideoRelation | null = null;
  for (const [k, ea] of aa) {
    const eb = ab.get(k);
    if (eb === undefined) continue;
    if (!ea && !eb) {
      lineage = "same";
      break;
    }
    lineage = "derived";
  }
  // Known lineage wins: an edit with new footage is "derived" even if the frames still look alike.
  if (lineage) return { relation: lineage, why: "lineage" };
  const ra = ix.byId.get(a);
  const rb = ix.byId.get(b);
  if (ra && rb) {
    if (ra.fingerprint && rb.fingerprint && fingerprintsMatch(ra.fingerprint, rb.fingerprint)) return { relation: "same", why: "fingerprint" };
    const na = sourceBasename(ra.sourcePath);
    if (na && na === sourceBasename(rb.sourcePath) && ra.durationS != null && rb.durationS != null && Math.abs(ra.durationS - rb.durationS) <= VIDEO_REPEAT.nameDurationS) {
      return { relation: "same", why: "name" };
    }
  }
  return null;
}

/** Every media row that is the same video as `id`, or derived footage of it (self included as "same"). */
export function videoFamily(ix: VideoIndex, id: string): Map<string, { relation: VideoRelation; why: VideoMatchWhy }> {
  const out = new Map<string, { relation: VideoRelation; why: VideoMatchWhy }>([[id, { relation: "same", why: "same-clip" }]]);
  const cand = new Set<string>();
  // Lineage: only rows of the same lineage component can share an ancestor.
  for (const other of ix.group.get(id) ?? []) cand.add(other);
  const row = ix.byId.get(id);
  const fp = row ? parseFingerprint(row.fingerprint) : null;
  if (fp) {
    // fps is sorted by duration: only the ±1 s window can match.
    let lo = 0;
    let hi = ix.fps.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ix.fps[mid]!.fp.durationS < fp.durationS - 1.0) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < ix.fps.length && ix.fps[i]!.fp.durationS <= fp.durationS + 1.0; i++) cand.add(ix.fps[i]!.id);
  }
  const n = sourceBasename(row?.sourcePath);
  if (n) for (const other of ix.byName.get(n) ?? []) cand.add(other);
  cand.delete(id);
  for (const other of cand) {
    const r = videoRelation(ix, id, other);
    if (r) out.set(other, r);
  }
  return out;
}

/**
 * Seconds of new edits an edit output adds over its source (pure, from the media_edits row; params are the stored
 * jsonb, read defensively). Reel: a new/mixed sound counts the whole output; a trim counts the seconds cut. Studio:
 * text on screen (summed), a sound (whole output), pieces from other clips, the first clip's cut seconds and any
 * speed change. Anything unreadable counts as 0 (= the same video: the strict side).
 */
export function editSecondsOf(e: { kind: string; params: unknown; soundId?: string | null; sourceDurationS: number | null; outputDurationS: number | null }): number {
  const p = (e.params ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const out = num(e.outputDurationS) ?? 0;
  const src = num(e.sourceDurationS);
  if (e.kind === "studio") {
    let s = 0;
    const texts = Array.isArray(p.texts) ? (p.texts as Array<Record<string, unknown>>) : [];
    for (const t of texts) {
      const a = num(t.startS);
      const b = num(t.endS);
      if (a != null && b != null && b > a && typeof t.text === "string" && t.text.trim()) s += b - a;
    }
    if (p.sound && typeof p.sound === "object") s += out;
    const clips = Array.isArray(p.clips) ? (p.clips as Array<Record<string, unknown>>) : [];
    const first = clips[0]?.mediaId;
    let kept = 0;
    for (const c of clips) {
      const a = num(c.inS);
      const b = num(c.outS);
      if (a == null || b == null || b <= a) continue;
      const speed = num(c.speed) ?? 1;
      if (c.mediaId !== first) s += (b - a) / (speed > 0 ? speed : 1);
      else {
        kept += b - a;
        if (speed !== 1) s += (b - a) / (speed > 0 ? speed : 1);
      }
    }
    if (src != null && clips.length > 0) s += Math.max(0, src - kept);
    return s;
  }
  // reel (and any other kind): sound + trim
  let s = 0;
  if (typeof p.audio === "string" && p.audio !== "original") s += out;
  if (src != null) {
    const a = num(p.trimStartS) ?? 0;
    const b = num(p.trimEndS) ?? src;
    s += Math.max(0, src - Math.max(0, Math.min(b, src) - Math.max(0, a)));
  }
  return s;
}

/** The item being checked. */
export interface ClipTarget {
  /** The item itself, when it exists (so it never matches itself). */
  id?: string;
  mediaId: string;
  platform: Platform;
  /** ISO, or null when untimed (then "now" is the reference time). */
  scheduledFor: string | null;
}

/** Another batch_items row, as the guard reads it. */
export interface ClipSibling {
  id: string;
  mediaId: string;
  platform: Platform;
  status: string;
  scheduledFor: string | null;
  /** When it went out: scheduled_for, else updated_at. Only read when published. */
  publishedAt?: string | null;
  /** Rejected with reason "already-posted": counts as published at its scheduled time. */
  alreadyPosted?: boolean;
}

export type VideoUseLevel = "block" | "warn";

export interface VideoUseHit extends ClipSibling {
  level: VideoUseLevel;
  relation: VideoRelation;
  why: VideoMatchWhy;
  /** It went out, or may have: published, publishing, unknown, or rejected as already posted. */
  wentOut: boolean;
  /** The reference time of the use (published / scheduled), ISO or null (untimed draft). */
  at: string | null;
}

export interface VideoUse {
  level: VideoUseLevel | null;
  /** The use to name in the message: blocks first, then what went out, then the nearest in time. */
  hit: VideoUseHit | null;
  hits: VideoUseHit[];
  /** Instagram + derived footage of a posted/planned clip: fine as a reel, not as a trial reel (trials need new content). */
  trialIneligible: boolean;
}

const WENT_OUT = new Set(["published", "publishing", "unknown"]);
const ms = (iso: string | null | undefined): number => (iso == null ? NaN : new Date(iso).getTime());

/** Does this row count as a use at all (and did it go out)? null = ignore it. */
export function useStatus(s: Pick<ClipSibling, "status" | "alreadyPosted">): { wentOut: boolean } | null {
  if (s.status === "rejected") return s.alreadyPosted ? { wentOut: true } : null;
  if (s.status === "failed") return null; // a final failure never went out
  return { wentOut: WENT_OUT.has(s.status) };
}

/**
 * Pure: classify the uses of a video on the target's platform. `relationOf(mediaId)` says how a sibling's media
 * relates to the target's (null = a different video). `wentOutOnly` (the outbox's last check) ignores plans.
 */
export function classifyVideoUse(
  target: ClipTarget,
  siblings: readonly ClipSibling[],
  relationOf: (mediaId: string) => { relation: VideoRelation; why: VideoMatchWhy } | null,
  now: Date,
  opts: { wentOutOnly?: boolean } = {},
): VideoUse {
  const ref = Number.isFinite(ms(target.scheduledFor)) ? ms(target.scheduledFor) : now.getTime();
  const hits: VideoUseHit[] = [];
  for (const s of siblings) {
    if ((target.id && s.id === target.id) || s.platform !== target.platform) continue;
    const st = useStatus(s);
    if (!st || (opts.wentOutOnly && !st.wentOut)) continue;
    const rel = s.mediaId === target.mediaId ? { relation: "same" as const, why: "same-clip" as const } : relationOf(s.mediaId);
    if (!rel) continue;
    const at = s.status === "published" ? s.publishedAt ?? s.scheduledFor : s.scheduledFor;
    const t = ms(at);
    const near = Number.isFinite(t) && Math.abs(t - ref) <= VIDEO_REPEAT.blockDays * DAY_MS;
    const level: VideoUseLevel = rel.relation === "same" && near ? "block" : "warn";
    hits.push({ ...s, level, relation: rel.relation, why: rel.why, wentOut: st.wentOut, at: Number.isFinite(t) ? new Date(t).toISOString() : null });
  }
  const dist = (h: VideoUseHit) => (h.at ? Math.abs(ms(h.at) - ref) : Infinity);
  hits.sort((a, b) => (a.level === b.level ? 0 : a.level === "block" ? -1 : 1) || Number(b.wentOut) - Number(a.wentOut) || dist(a) - dist(b) || a.id.localeCompare(b.id));
  const hit = hits[0] ?? null;
  return {
    level: hit?.level ?? null,
    hit,
    hits,
    trialIneligible: target.platform === "instagram" && hits.some((h) => h.relation === "derived"),
  };
}

const PLATFORM_WORD: Record<Platform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", snapchat: "Snapchat" };
const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri Nov 20" in the creator's zone. */
export function shortDay(iso: string, timeZone: string): string {
  const ymd = localDate(new Date(iso), timeZone);
  const [, m, d] = ymd.split("-").map(Number);
  return `${WEEKDAY[weekdayIndex(ymd)]} ${MONTH[(m ?? 1) - 1]} ${d}`;
}

/**
 * The warning line, e.g. "This video was already posted on Instagram on Fri Nov 20". Names a platform and a day only:
 * never a clip name, path or place.
 */
export function videoUseMessage(use: Pick<VideoUse, "hit" | "trialIneligible">, timeZone: string): string {
  const h = use.hit;
  if (!h) return "";
  const p = PLATFORM_WORD[h.platform];
  const day = h.at ? shortDay(h.at, timeZone) : null;
  const trial = use.trialIneligible && h.platform === "instagram" ? " · not as a trial reel (trials need new content)" : "";
  if (h.relation === "derived") {
    return h.wentOut ? `Uses footage you posted on ${p}${day ? ` on ${day}` : ""}${trial}` : `Uses footage already planned for ${p}${day ? ` on ${day}` : ""}${trial}`;
  }
  if (!day) return `This video is also planned for ${p} (no time yet)`;
  const old = h.level === "warn" ? ` (over ${VIDEO_REPEAT.blockDays} days apart)` : "";
  return h.wentOut ? `This video was already posted on ${p} on ${day}${old}` : `This video is already scheduled on ${p} for ${day}${old}`;
}
