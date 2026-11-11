import { run } from "./exec.js";
import { probe } from "./probe.js";

export interface TouchUpOptions {
  outPath: string;
  /** Explicit opt-in only (a creative decision, never automatic): path to a track that replaces the audio track entirely. */
  replaceAudioWith?: string;
  /** Loudness-normalize the existing audio track to -14 LUFS. Default true when there's audio and it isn't being replaced. */
  normalizeLoudness?: boolean;
}

/** Always strips all metadata (GPS/EXIF/QuickTime location, per CLAUDE.md's location boundary) regardless of what was detected. */
export async function touchUp(filePath: string, opts: TouchUpOptions): Promise<void> {
  const info = await probe(filePath);
  const metaArgs = ["-map_metadata", "-1", "-map_chapters", "-1"];

  if (opts.replaceAudioWith) {
    const fadeStart = Math.max(0, info.durationS - 1.5);
    const filter = `[1:a]atrim=0:${info.durationS},afade=t=out:st=${fadeStart}:d=1.5,loudnorm=I=-14:TP=-2.0:LRA=11,alimiter=limit=0.8:level=disable[a]`;
    await run("ffmpeg", [
      "-y",
      "-i",
      filePath,
      "-i",
      opts.replaceAudioWith,
      "-filter_complex",
      filter,
      "-map",
      "0:v",
      "-map",
      "[a]",
      ...metaArgs,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      opts.outPath,
    ]);
    return;
  }

  if (info.hasAudio && opts.normalizeLoudness !== false) {
    await run("ffmpeg", [
      "-y",
      "-i",
      filePath,
      "-af",
      "loudnorm=I=-14:TP=-2.0:LRA=11,alimiter=limit=0.8:level=disable",
      ...metaArgs,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      opts.outPath,
    ]);
    return;
  }

  // No audio, or normalization explicitly declined: strip metadata only, no re-encode needed.
  await run("ffmpeg", ["-y", "-i", filePath, ...metaArgs, "-c", "copy", opts.outPath]);
}
