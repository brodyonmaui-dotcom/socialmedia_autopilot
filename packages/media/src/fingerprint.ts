import { execFile } from "node:child_process";
import { probe } from "./probe.js";

/**
 * F26 A: the ffmpeg side of the video fingerprint (the hashing and matching are pure, in packages/core
 * video-fingerprint.ts). 8 frames at 10/20/.../80% of the clip, each scaled to 9×8 and converted to 8-bit grey,
 * read raw from stdout: nothing is written to disk and no metadata is read or kept. One ffmpeg at a time.
 */
export const FINGERPRINT_FRACTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] as const;
const FRAME_BYTES = 9 * 8;
const FRAME_TIMEOUT_MS = 30_000;

/** ffmpeg args for one 9×8 grey frame at `atS` on stdout (pure). Fast input seek, video only, area scaling. */
export function fingerprintFrameArgs(input: string, atS: number): string[] {
  const at = Number.isFinite(atS) && atS > 0 ? String(Math.round(atS * 1000) / 1000) : "0";
  return ["-v", "error", "-nostdin", "-ss", at, "-i", input, "-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", "1", "-vf", "scale=9:8:flags=area,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"];
}

function grabFrame(input: string, atS: number, timeoutMs: number): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    execFile("ffmpeg", fingerprintFrameArgs(input, atS), { encoding: "buffer", maxBuffer: 1024 * 1024, timeout: timeoutMs, killSignal: "SIGKILL" }, (err, stdout) => {
      const buf = stdout as unknown as Buffer;
      if (err || !buf || buf.length < FRAME_BYTES) return resolve(null);
      resolve(new Uint8Array(buf.subarray(0, FRAME_BYTES)));
    });
  });
}

/**
 * The 8 grey frames (72 bytes each, null = not read) and the duration used to place them. The duration is probed
 * when not given. Never throws: an unreadable file gives all nulls (the caller stores no fingerprint). Stops early
 * when the first two frames both fail (not a video ffmpeg can read), so a bad file costs two ffmpeg runs, not eight.
 */
export async function grabFingerprintFrames(input: string, opts: { durationS?: number | null; timeoutMs?: number } = {}): Promise<{ durationS: number | null; frames: Array<Uint8Array | null> }> {
  let durationS = opts.durationS != null && Number.isFinite(opts.durationS) && opts.durationS > 0 ? opts.durationS : null;
  if (durationS == null) {
    try {
      const d = (await probe(input)).durationS;
      durationS = Number.isFinite(d) && d > 0 ? d : null;
    } catch {
      durationS = null;
    }
  }
  const frames: Array<Uint8Array | null> = FINGERPRINT_FRACTIONS.map(() => null);
  if (durationS == null) return { durationS, frames };
  for (const [i, f] of FINGERPRINT_FRACTIONS.entries()) {
    frames[i] = await grabFrame(input, durationS * f, opts.timeoutMs ?? FRAME_TIMEOUT_MS);
    if (i === 1 && !frames[0] && !frames[1]) break;
  }
  return { durationS, frames };
}
