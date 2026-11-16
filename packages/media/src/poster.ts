import { existsSync, rmSync, statSync } from "node:fs";
import { run } from "./exec.js";

/** Long side of a poster frame, in px. Small: it's a thumbnail, not a cover image. */
export const POSTER_LONG_SIDE = 640;

/** Where the poster frame is taken: min(1 s, 10% of the duration); 0 when the duration is unknown. */
export function posterAtSeconds(durationS: number): number {
  if (!Number.isFinite(durationS) || durationS <= 0) return 0;
  return Math.min(1, durationS * 0.1);
}

/**
 * ffmpeg args for one JPEG poster frame (pure). Seeks before the input (fast), one video frame only,
 * long side scaled to 640 px, quality 4, and ALL metadata dropped (`-map_metadata -1`, no chapters, no
 * audio/subtitle/data streams, bitexact so not even an encoder comment): the image2 muxer writes a bare JFIF, so no EXIF/GPS can survive
 * (CLAUDE.md location boundary).
 */
export function posterArgs(input: string, output: string, atSeconds: number): string[] {
  const at = Number.isFinite(atSeconds) && atSeconds > 0 ? String(Math.round(atSeconds * 1000) / 1000) : "0";
  const side = POSTER_LONG_SIDE;
  return [
    "-y",
    "-ss",
    at,
    "-i",
    input,
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-an",
    "-sn",
    "-dn",
    "-fflags",
    "+bitexact",
    "-flags:v",
    "+bitexact",
    "-frames:v",
    "1",
    "-vf",
    `scale=${side}:${side}:force_original_aspect_ratio=decrease`,
    "-pix_fmt",
    "yuvj420p",
    "-q:v",
    "4",
    "-f",
    "image2",
    output,
  ];
}

/**
 * Writes one poster JPEG for a video. `run` never throws on a non-zero ffmpeg exit, so the output is
 * checked: a missing or empty file throws `poster: ...` (and an empty leftover is removed).
 */
export async function makePoster(inputPath: string, outPath: string, opts: { durationS: number }): Promise<void> {
  if (existsSync(outPath)) rmSync(outPath, { force: true });
  await run("ffmpeg", ["-v", "error", ...posterArgs(inputPath, outPath, posterAtSeconds(opts.durationS))]);
  if (!existsSync(outPath) || statSync(outPath).size === 0) {
    rmSync(outPath, { force: true });
    throw new Error("poster: ffmpeg wrote no frame");
  }
}
