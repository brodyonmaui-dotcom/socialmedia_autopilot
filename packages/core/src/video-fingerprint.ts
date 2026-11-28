/**
 * F26 A: a perceptual fingerprint per clip, so a re-upload (new content_hash) or a re-encoded copy of a posted video
 * is still the same video. Pure: the ffmpeg side (8×9 grey frames) lives in packages/media `computeFingerprint`.
 *
 * Text form (media.fingerprint, migration 0018): `v1:<duration s>:<h1>,...,<h8>`, each h a 64-bit dHash in 16 hex
 * digits taken at 10/20/.../80% of the clip, or "-" for a flat frame (black, white, one colour: no usable detail).
 * Match = durations within 1.0 s and ≥ 6 of the 8 frame pairs within Hamming distance 10. A flat frame never counts
 * as a matching pair, so two different near-black clips can't block each other.
 */
export const FINGERPRINT_POSITIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] as const;
export const FINGERPRINT_MATCH = { durationS: 1.0, minFrames: 6, maxHamming: 10 } as const;
/** dHash input: 9 columns × 8 rows of 8-bit grey (72 bytes, row-major). */
export const DHASH_W = 9;
export const DHASH_H = 8;
/** A frame whose grey range (max − min) is below this is flat: its hash is noise, so it is stored as "-". */
export const FLAT_FRAME_RANGE = 8;

export interface Fingerprint {
  durationS: number;
  /** 8 entries, each 16 lower-case hex digits, or null for a flat / unreadable frame. */
  frames: Array<string | null>;
}

const HEX16 = /^[0-9a-f]{16}$/;

/** dHash of one 9×8 grey frame: bit = left pixel > right pixel, row by row (64 bits). Null when the frame is flat. */
export function dHashFromGray(px: ArrayLike<number>): string | null {
  if (px.length < DHASH_W * DHASH_H) return null;
  let min = 255;
  let max = 0;
  for (let i = 0; i < DHASH_W * DHASH_H; i++) {
    const v = px[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < FLAT_FRAME_RANGE) return null;
  let hi = 0;
  let lo = 0;
  for (let y = 0; y < DHASH_H; y++) {
    for (let x = 0; x < DHASH_W - 1; x++) {
      const bit = px[y * DHASH_W + x]! > px[y * DHASH_W + x + 1]! ? 1 : 0;
      const n = y * (DHASH_W - 1) + x; // 0..63, MSB first
      if (n < 32) hi = (hi | (bit << (31 - n))) >>> 0;
      else lo = (lo | (bit << (63 - n))) >>> 0;
    }
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

export function formatFingerprint(f: Fingerprint): string {
  const d = Math.round(f.durationS * 100) / 100;
  return `v1:${d}:${f.frames.map((h) => (h && HEX16.test(h) ? h : "-")).join(",")}`;
}

/** Null for anything that isn't a well-formed v1 fingerprint (old/garbled values never match anything). */
export function parseFingerprint(s: string | null | undefined): Fingerprint | null {
  if (typeof s !== "string") return null;
  const m = /^v1:(\d+(?:\.\d+)?):([0-9a-f,-]+)$/.exec(s.trim());
  if (!m) return null;
  const durationS = Number(m[1]);
  const parts = m[2]!.split(",");
  if (!Number.isFinite(durationS) || parts.length !== FINGERPRINT_POSITIONS.length) return null;
  const frames: Array<string | null> = [];
  for (const p of parts) {
    if (p === "-") frames.push(null);
    else if (HEX16.test(p)) frames.push(p);
    else return null;
  }
  return { durationS, frames };
}

function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Hamming distance between two 16-hex-digit hashes. */
export function hamming64(a: string, b: string): number {
  const x = (parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) >>> 0;
  const y = (parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16)) >>> 0;
  return popcount32(x) + popcount32(y);
}

/** How many frame pairs are close (both non-flat, Hamming ≤ maxHamming). */
export function matchingFrames(a: Fingerprint, b: Fingerprint, maxHamming: number = FINGERPRINT_MATCH.maxHamming): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.frames.length, b.frames.length); i++) {
    const x = a.frames[i];
    const y = b.frames[i];
    if (x && y && hamming64(x, y) <= maxHamming) n++;
  }
  return n;
}

/** Same video by fingerprint: durations within 1.0 s and ≥ 6 of 8 frames within Hamming 10. Accepts text or parsed. */
export function fingerprintsMatch(a: Fingerprint | string | null | undefined, b: Fingerprint | string | null | undefined): boolean {
  const fa = typeof a === "string" || a == null ? parseFingerprint(a) : a;
  const fb = typeof b === "string" || b == null ? parseFingerprint(b) : b;
  if (!fa || !fb) return false;
  if (Math.abs(fa.durationS - fb.durationS) > FINGERPRINT_MATCH.durationS) return false;
  return matchingFrames(fa, fb) >= FINGERPRINT_MATCH.minFrames;
}

/**
 * The stored text from the 8 grey frames packages/media `grabFingerprintFrames` returns (null = frame not read).
 * Null when the duration is unknown or fewer than FINGERPRINT_MATCH.minFrames frames were read: such a clip
 * could never match, so nothing is stored and the other rules (lineage, name) still apply.
 */
export function fingerprintFromFrames(durationS: number | null | undefined, frames: ReadonlyArray<ArrayLike<number> | null>): string | null {
  if (durationS == null || !Number.isFinite(durationS) || durationS <= 0) return null;
  if (frames.length !== FINGERPRINT_POSITIONS.length) return null;
  const read = frames.filter((f) => f != null && f.length >= DHASH_W * DHASH_H).length;
  if (read < FINGERPRINT_MATCH.minFrames) return null;
  return formatFingerprint({ durationS, frames: frames.map((f) => (f ? dHashFromGray(f) : null)) });
}
