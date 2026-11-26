import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { edlArgs, edlLoudnessArgs, EDL_LIMITS, outputDuration, type Edl, type EdlInputs } from "./edl.js";
import { run, runChecked } from "./exec.js";
import { FFMPEG_MISSING_MESSAGE, FIX_LIMITS, FixError, fileStats, type FixStats } from "./fix.js";
import { parseLoudnormMeasurement } from "./parse.js";
import { posterArgs, posterAtSeconds } from "./poster.js";
import { probe, probeLocationTagKeys } from "./probe.js";

/**
 * Studio renderer (F24): runs the pure args from edl.ts. Loudness pass 1 → encode into ONE new file (time-boxed) →
 * checks (length within 0.5 s of the EDL, 1080x1920, no location tag). Inputs are only read; a failed run removes
 * its own half-written output. Throws FixError in plain words.
 */

/** Alpine `font-dejavu` (the worker image, apps/worker/Dockerfile), then Debian `fonts-dejavu-core`. */
export const STUDIO_FONT_CANDIDATES = {
  bold: ["/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
  plain: ["/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"],
} as const;
/** Default font path in the worker image. Override with STUDIO_FONT_PATH (bold) / STUDIO_FONT_PLAIN_PATH. */
export const STUDIO_FONT_PATH = STUDIO_FONT_CANDIDATES.bold[0];

/** The fonts to draw with: env override, else the first candidate that exists, else the image default. */
export function studioFonts(env: Record<string, string | undefined> = process.env, exists: (p: string) => boolean = existsSync): { bold: string; plain: string } {
  const pick = (override: string | undefined, list: readonly string[]) => override?.trim() || list.find((p) => exists(p)) || list[0]!;
  const bold = pick(env.STUDIO_FONT_PATH, STUDIO_FONT_CANDIDATES.bold);
  return { bold, plain: env.STUDIO_FONT_PLAIN_PATH?.trim() || (env.STUDIO_FONT_PATH?.trim() ? bold : pick(undefined, STUDIO_FONT_CANDIDATES.plain)) };
}

async function ffmpeg(args: string[], timeoutMs: number) {
  const r = await runChecked("ffmpeg", args, { timeoutMs });
  if (r.missing) throw new FixError(FFMPEG_MISSING_MESSAGE, "ffmpeg-missing");
  if (r.timedOut) throw new FixError("The Studio export took too long and was stopped.", "timeout");
  return r;
}

export interface RunEdlInputs extends Omit<EdlInputs, "clipHasAudio" | "plainFontPath"> {
  plainFontPath?: string;
}

/**
 * Renders an EDL. `clipHasAudio` is probed here (a clip without an audio track gets silence). Every clip's out
 * point must be inside its file (checked against ffprobe, 0.05 s tolerance).
 */
export async function runEdl(edl: Edl, inputs: RunEdlInputs, opts: { timeoutMs?: number } = {}): Promise<{ outPath: string; durationS: number; after: FixStats }> {
  const timeoutMs = opts.timeoutMs ?? EDL_LIMITS.timeoutMs;
  const out = resolve(inputs.outPath);
  const reads = [...inputs.clipPaths, ...(inputs.soundPath ? [inputs.soundPath] : [])].map((p) => resolve(p));
  if (reads.includes(out)) throw new FixError("The export must be a new file, never over a clip.", "unsafe");
  if (existsSync(out)) throw new FixError("The output file already exists; nothing was overwritten.", "unsafe");
  if (inputs.fontPath && edl.texts.length && !existsSync(inputs.fontPath)) throw new FixError("The text font is missing in the worker. Rebuild the worker image.", "refused");
  const expected = outputDuration(edl);
  try {
    const probes = new Map<string, Awaited<ReturnType<typeof probe>>>();
    for (const p of new Set(inputs.clipPaths)) probes.set(p, await probe(p));
    edl.clips.forEach((c, i) => {
      const pr = probes.get(inputs.clipPaths[i]!)!;
      if (pr.durationS > 0 && c.outS > pr.durationS + 0.05) throw new FixError(`Clip ${i + 1}'s out point is past the end of the clip.`, "refused");
    });
    const full: EdlInputs = { ...inputs, clipHasAudio: inputs.clipPaths.map((p) => probes.get(p)!.hasAudio) };
    const pass1 = await ffmpeg(edlLoudnessArgs(edl, full), timeoutMs);
    const m = parseLoudnormMeasurement(pass1.stderr);
    const measured = m && Number.isFinite(m.inputIntegrated) ? m : null; // silence → loudness left as it is
    const r = await ffmpeg(edlArgs(edl, full, { measured }), timeoutMs);
    if (r.code !== 0 || !existsSync(out) || statSync(out).size === 0) throw new FixError("ffmpeg couldn't make this video.");
    const after = await fileStats(out, timeoutMs);
    if (Math.abs(after.durationS - expected) > 0.5) throw new FixError("The video came out the wrong length, so it was not kept.");
    if (after.width !== FIX_LIMITS.padWidth || after.height !== FIX_LIMITS.padHeight) throw new FixError("The video came out the wrong size, so it was not kept.");
    if ((await probeLocationTagKeys(out)).length) throw new FixError("Location details survived, so the video was not kept.", "unsafe");
    return { outPath: out, durationS: after.durationS, after };
  } catch (err) {
    rmSync(out, { force: true }); // only the file this run wrote
    throw err instanceof FixError ? err : new FixError(`The Studio export failed: ${String((err as Error)?.message ?? err).split("\n")[0]!.slice(0, 120)}`);
  }
}

/** Poster at the EDL's cover frame (or the usual 10%/1 s frame). Metadata-free JPEG (poster.ts posterArgs). */
export async function makeCoverPoster(inputPath: string, outPath: string, opts: { durationS: number; coverS: number | null }): Promise<void> {
  const at = opts.coverS != null && opts.coverS >= 0 && opts.coverS < opts.durationS ? opts.coverS : posterAtSeconds(opts.durationS);
  rmSync(outPath, { force: true });
  await run("ffmpeg", ["-v", "error", ...posterArgs(inputPath, outPath, at)]);
  if (!existsSync(outPath) || statSync(outPath).size === 0) {
    rmSync(outPath, { force: true });
    throw new Error("poster: ffmpeg produced no image");
  }
}
