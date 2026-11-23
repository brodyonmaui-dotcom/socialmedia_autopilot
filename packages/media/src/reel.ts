import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runChecked } from "./exec.js";
import { ENCODE_ARGS, FFMPEG_MISSING_MESSAGE, FIX_LIMITS, FixError, fileStats, loudnormApply, loudnormMeasure, padFilters, type FixStats } from "./fix.js";
import { parseLoudnormMeasurement, type LoudnormMeasurement } from "./parse.js";
import { probeLocationTagKeys } from "./probe.js";
import { REEL_LIMITS, type ReelPlan } from "./reel-plan.js";

export * from "./reel-plan.js";

/**
 * Reel maker engine ("Make a reel", F20 E). `planReel` (reel-plan.ts, pure) validates the request;
 * `reelAudioGraph` / `reelLoudnessArgs` / `reelArgs` build the ffmpeg args (pure); `runReel` runs them into
 * ONE new file. Input 0 is the clip (only read), input 1 the sound (looped with -stream_loop, then cut to
 * length). Always 1080×1920 (the touch-up blurred fill), two-pass loudnorm to -14 LUFS, and every output
 * drops all metadata and chapters, so no GPS/location tag can survive (re-probed to prove it).
 */

const f = (n: number) => String(Math.round(n * 1000) / 1000);
const AFMT = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";

/** The audio part of the graph (pure): ends in `[a_mix]`, exactly `plan.durationS` long. */
export function reelAudioGraph(p: ReelPlan): string {
  const d = p.durationS;
  const parts: string[] = [];
  if (p.usesOriginal) {
    parts.push(`[0:a:0]atrim=start=${f(p.start)}:end=${f(p.end)},asetpts=PTS-STARTPTS,${AFMT},apad=whole_dur=${f(d)},atrim=end=${f(d)},volume=${f(p.originalVolume)}[a_orig]`);
  }
  if (p.usesSound) {
    const fadeOutAt = Math.max(0, d - REEL_LIMITS.fadeOutS);
    parts.push(
      `[1:a:0]atrim=start=0:end=${f(d)},asetpts=PTS-STARTPTS,${AFMT},volume=${f(p.soundVolume)},` +
        `afade=t=in:st=0:d=${f(REEL_LIMITS.fadeInS)},afade=t=out:st=${f(fadeOutAt)}:d=${f(REEL_LIMITS.fadeOutS)}[a_snd]`,
    );
  }
  if (p.usesOriginal && p.usesSound) parts.push(`[a_orig][a_snd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a_mix]`);
  else if (p.usesSound) parts[0] = parts[0]!.replace(/\[a_snd\]$/, "[a_mix]");
  else parts[0] = parts[0]!.replace(/\[a_orig\]$/, "[a_mix]");
  return parts.join(";");
}

/** `-i clip` plus, when the plan uses a sound, `-stream_loop -1 -i sound` (looped; atrim cuts it). */
function inputs(input: string, sound: string | null, p: ReelPlan): string[] {
  if (p.usesSound && !sound) throw new Error("reelArgs: this plan needs a sound file");
  return ["-i", input, ...(p.usesSound ? ["-stream_loop", "-1", "-i", sound!] : [])];
}

/** Pass 1 of the two-pass loudnorm (pure): measures the final audio (trimmed, mixed, faded). */
export function reelLoudnessArgs(input: string, sound: string | null, p: ReelPlan): string[] {
  return ["-hide_banner", "-nostats", ...inputs(input, sound, p), "-filter_complex", `${reelAudioGraph(p)};[a_mix]${loudnormMeasure()}[a_m]`, "-map", "[a_m]", "-f", "null", "-"];
}

export interface ReelArgsOptions {
  /** Pass-1 measurement; without it (silent audio) loudness is left as it is. */
  measured?: LoudnormMeasurement;
  /** Cap the frame rate at 60 fps (source above 60). */
  capFps?: boolean;
}

/**
 * The encode (pure): trim → 1080×1920 blurred fill → H.264; audio graph → loudnorm pass 2 → AAC 48 kHz.
 * `-t` bounds the output to the plan length (the looped sound is infinite). All metadata dropped.
 */
export function reelArgs(input: string, sound: string | null, out: string, p: ReelPlan, opts: ReelArgsOptions = {}): string[] {
  const m = opts.measured;
  const norm = m && Number.isFinite(m.inputIntegrated) ? `${loudnormApply(m)},` : "";
  const graph = [
    `[0:v:0]trim=start=${f(p.start)}:end=${f(p.end)},setpts=PTS-STARTPTS[v_trim]`,
    ...padFilters("[v_trim]", opts.capFps ? `fps=${FIX_LIMITS.maxFps},` : ""),
    reelAudioGraph(p),
    `[a_mix]${norm}aresample=48000[a_out]`,
  ];
  return [
    "-hide_banner",
    "-nostats",
    ...inputs(input, sound, p),
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[v_out]",
    "-map",
    "[a_out]",
    ...ENCODE_ARGS.aac,
    ...ENCODE_ARGS.x264,
    "-t",
    f(p.durationS),
    "-sn",
    "-dn",
    ...ENCODE_ARGS.stripMetadata,
    "-movflags",
    "+faststart",
    "-y",
    out,
  ];
}

async function ffmpeg(args: string[], timeoutMs: number) {
  const r = await runChecked("ffmpeg", args, { timeoutMs });
  if (r.missing) throw new FixError(FFMPEG_MISSING_MESSAGE, "ffmpeg-missing");
  if (r.timedOut) throw new FixError("Making the reel took too long and was stopped.", "timeout");
  return r;
}

/**
 * Runs a reel plan: loudness pass 1 → encode into `outPath` (time-boxed) → checks the result (length
 * within 0.5 s of the plan, 1080×1920, no location tags). Throws FixError in plain words; a failed run
 * removes its own half-written output. Never writes to the clip or the sound.
 */
export async function runReel(
  inputPath: string,
  soundPath: string | null,
  outPath: string,
  plan: ReelPlan,
  opts: { timeoutMs?: number; capFps?: boolean } = {},
): Promise<{ after: FixStats }> {
  const timeoutMs = opts.timeoutMs ?? REEL_LIMITS.timeoutMs;
  const out = resolve(outPath);
  if (out === resolve(inputPath) || (soundPath && out === resolve(soundPath))) throw new FixError("The reel must be a new file, never over the original.", "unsafe");
  if (plan.refusal) throw new FixError(plan.refusal, "refused");
  if (plan.usesSound && !soundPath) throw new FixError("This reel needs a sound, and none was given.", "refused");
  if (existsSync(outPath)) throw new FixError("The output file already exists; nothing was overwritten.", "unsafe");
  try {
    const pass1 = await ffmpeg(reelLoudnessArgs(inputPath, soundPath, plan), timeoutMs);
    const measured = parseLoudnormMeasurement(pass1.stderr);
    const r = await ffmpeg(reelArgs(inputPath, soundPath, outPath, plan, { measured, capFps: opts.capFps }), timeoutMs);
    if (r.code !== 0 || !existsSync(outPath) || statSync(outPath).size === 0) throw new FixError("ffmpeg couldn't make this reel.");
    const after = await fileStats(outPath, timeoutMs);
    if (Math.abs(after.durationS - plan.durationS) > 0.5 || after.durationS < REEL_LIMITS.minDurationS) throw new FixError("The reel came out the wrong length, so it was not kept.");
    if (after.width !== FIX_LIMITS.padWidth || after.height !== FIX_LIMITS.padHeight) throw new FixError("The reel came out the wrong size, so it was not kept.");
    if ((await probeLocationTagKeys(outPath)).length) throw new FixError("Location details survived, so the reel was not kept.", "unsafe");
    return { after };
  } catch (err) {
    rmSync(outPath, { force: true }); // only the file this run wrote
    throw err instanceof FixError ? err : new FixError(`Making the reel failed: ${String((err as Error)?.message ?? err).split("\n")[0]!.slice(0, 120)}`);
  }
}
