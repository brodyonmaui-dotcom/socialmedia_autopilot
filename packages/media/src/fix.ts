import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runChecked } from "./exec.js";
import { parseLoudnormMeasurement, type LoudnormMeasurement } from "./parse.js";
import { probe, probeLocationTagKeys } from "./probe.js";
import type { QaResult, Segment } from "./qa.js";
import { FIX_OP_ORDER, OP_FOR_CODE, type FixOp, type QaIssueCode } from "./qa-types.js";

export { FIX_OP_ORDER, OP_FOR_CODE, OPT_IN_OPS, type FixOp } from "./qa-types.js";

/**
 * Touch-up "Fix it" engine. `planFix` turns a clip's QA issues into one plan (pure); `encodeArgs` /
 * `loudnessMeasureArgs` build the ffmpeg args (pure); `runFix` runs them into ONE new output file.
 * The input is only read, never overwritten. Every output drops all metadata and chapters, so no
 * GPS/location tag can survive (CLAUDE.md location boundary); the result is re-probed to prove it.
 */

export const FIX_LIMITS = {
  minDurationS: 1,
  /** Trims/cuts may remove at most this share of the clip. */
  maxCutShare: 0.3,
  /** Silence kept on each side of a removed gap, so speech isn't clipped. */
  gapPadS: 0.3,
  timeoutMs: 15 * 60_000,
  targetLufs: -14,
  targetTruePeak: -1.5,
  targetLra: 11,
  padWidth: 1080,
  padHeight: 1920,
  maxFps: 60,
} as const;

const sortOps = (ops: Iterable<FixOp>): FixOp[] => FIX_OP_ORDER.filter((o) => new Set(ops).has(o));

/** Every op this clip's issues allow (fixable issues of either severity), canonical order. */
export function availableOps(qa: Pick<QaResult, "issues">): FixOp[] {
  return sortOps((qa.issues ?? []).filter((i) => i.fixable).flatMap((i) => (OP_FOR_CODE[i.code] ? [OP_FOR_CODE[i.code]!] : [])));
}

/** What "Fix it" does by default: the fixable `fix` issues only (opt-in ops excluded). */
export function defaultOps(qa: Pick<QaResult, "issues">): FixOp[] {
  return sortOps((qa.issues ?? []).filter((i) => i.fixable && i.severity === "fix").flatMap((i) => (OP_FOR_CODE[i.code] ? [OP_FOR_CODE[i.code]!] : [])));
}

export interface FixPlan {
  /** Ordered, only ops the issues allow, always ends with "strip". */
  ops: FixOp[];
  /** Source-time ranges kept, in order (one range = the whole clip or a head/tail trim). */
  keep: Segment[];
  sourceDurationS: number;
  expectedDurationS: number;
  hasAudio: boolean;
  /** Video must be decoded + re-encoded (trim/cut/format/rotation/pad). Otherwise it's stream-copied. */
  reencodeVideo: boolean;
  pad: boolean;
  loudness: boolean;
  /** Cap the frame rate (source above 60 fps). */
  capFps: boolean;
  /** The ffmpeg steps, in order. */
  steps: Array<"measure-loudness" | "encode">;
  /** Set when the plan must not run (plain words); runFix refuses it. */
  refusal: string | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const total = (segs: Segment[]) => segs.reduce((n, s) => n + Math.max(0, s.end - s.start), 0);

/**
 * The plan for `ops` (default: `defaultOps`) on a clip with this QA (pure). Requested ops the issues
 * don't allow are dropped. Trims cut to the detected segment bounds (frame-accurate: the video is
 * re-encoded, so no keyframe snapping is needed). Refuses below 1 s or above 30% cut.
 */
export function planFix(qa: QaResult, ops?: FixOp[]): FixPlan {
  const allowed = new Set(availableOps(qa));
  const wanted = sortOps([...(ops ?? defaultOps(qa)).filter((o) => allowed.has(o)), "strip"]);
  const dur = qa.probe.durationS > 0 ? qa.probe.durationS : 0;
  const hasAudio = qa.probe.hasAudio;
  const issues = qa.issues ?? [];
  const segsOf = (codes: QaIssueCode[]) => issues.filter((i) => codes.includes(i.code)).flatMap((i) => i.segments ?? []);

  let start = 0;
  let end = dur;
  if (wanted.includes("trim")) {
    const head = segsOf(["frozen-head", "black-head"]);
    const tail = segsOf(["frozen-tail", "black-tail"]);
    if (head.length) start = Math.max(...head.map((s) => s.end));
    if (tail.length) end = Math.min(...tail.map((s) => s.start));
  }
  let keep: Segment[] = end > start ? [{ start: r3(start), end: r3(end) }] : [];
  if (wanted.includes("remove-gaps") && keep.length) {
    const cuts = segsOf(["silence-gaps"])
      .map((g) => ({ start: g.start + FIX_LIMITS.gapPadS, end: g.end - FIX_LIMITS.gapPadS }))
      .filter((g) => g.end > g.start)
      .sort((a, b) => a.start - b.start);
    const out: Segment[] = [];
    let cursor = keep[0]!.start;
    const stop = keep[0]!.end;
    for (const c of cuts) {
      if (c.end <= cursor || c.start >= stop) continue;
      if (c.start > cursor) out.push({ start: r3(cursor), end: r3(c.start) });
      cursor = Math.max(cursor, c.end);
    }
    if (stop > cursor) out.push({ start: r3(cursor), end: r3(stop) });
    keep = out;
  }

  const expected = r3(total(keep));
  let refusal: string | null = null;
  if (dur > 0 && expected < FIX_LIMITS.minDurationS) refusal = "The fixed clip would be shorter than 1 second, so nothing was changed.";
  else if (dur > 0 && dur - expected > FIX_LIMITS.maxCutShare * dur + 0.001)
    refusal = "The fix would cut more than 30% of the clip, so nothing was changed. Trim it by hand instead.";

  const cut = dur > 0 && (keep.length !== 1 || keep[0]!.start > 0.001 || keep[0]!.end < dur - 0.001);
  const pad = wanted.includes("pad");
  const loudness = hasAudio && wanted.includes("loudness");
  const reencodeVideo = cut || pad || wanted.includes("reencode");
  return {
    ops: wanted.filter((o) => o !== "loudness" || loudness),
    keep: cut ? keep : [{ start: 0, end: r3(dur) }],
    sourceDurationS: r3(dur),
    expectedDurationS: expected,
    hasAudio,
    reencodeVideo,
    pad,
    loudness,
    capFps: reencodeVideo && qa.probe.fps > FIX_LIMITS.maxFps + 0.5,
    steps: loudness ? ["measure-loudness", "encode"] : ["encode"],
    refusal,
  };
}

/** True when the plan keeps the whole source untouched in time. */
const isWhole = (p: FixPlan) => p.keep.length === 1 && p.keep[0]!.start <= 0.001 && p.keep[0]!.end >= p.sourceDurationS - 0.001;

/** Audio part of the graph: keep ranges (atrim + concat) → label `[a_cut]`; null when nothing to cut. */
function audioCut(p: FixPlan): string | null {
  if (isWhole(p)) return null;
  const parts = p.keep.map((k, i) => `[0:a:0]atrim=start=${k.start}:end=${k.end},asetpts=PTS-STARTPTS[a${i}]`);
  if (p.keep.length === 1) return `${parts[0]!.replace(/\[a0\]$/, "[a_cut]")}`;
  return `${parts.join(";")};${p.keep.map((_, i) => `[a${i}]`).join("")}concat=n=${p.keep.length}:v=0:a=1[a_cut]`;
}

const loudnormMeasure = () => `loudnorm=I=${FIX_LIMITS.targetLufs}:TP=${FIX_LIMITS.targetTruePeak}:LRA=${FIX_LIMITS.targetLra}:print_format=json`;

function loudnormApply(m: LoudnormMeasurement): string {
  const f = (n: number) => (Number.isFinite(n) ? String(n) : "0");
  return (
    `loudnorm=I=${FIX_LIMITS.targetLufs}:TP=${FIX_LIMITS.targetTruePeak}:LRA=${FIX_LIMITS.targetLra}` +
    `:measured_I=${f(m.inputIntegrated)}:measured_TP=${f(m.inputTruePeak)}:measured_LRA=${f(m.inputLra)}:measured_thresh=${f(m.inputThreshold)}` +
    `:offset=${f(m.targetOffset)}:linear=true:print_format=summary`
  );
}

/** Pass 1 of the two-pass loudnorm (pure): measures the audio exactly as it will be cut. */
export function loudnessMeasureArgs(input: string, p: FixPlan): string[] {
  const cut = audioCut(p);
  const graph = cut ? ["-filter_complex", `${cut};[a_cut]${loudnormMeasure()}[a_m]`, "-map", "[a_m]"] : ["-map", "0:a:0", "-af", loudnormMeasure()];
  return ["-hide_banner", "-nostats", "-i", input, "-vn", ...graph, "-f", "null", "-"];
}

const META = ["-map_metadata", "-1", "-map_chapters", "-1"];
const AAC = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"];
const X264 = ["-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"];

/**
 * The encode (pure). Always: all metadata + chapters dropped, `+faststart`, one video + at most one audio
 * stream. Re-encode path: H.264 high, yuv420p, even size, AAC 48 kHz; ffmpeg's autorotate bakes any
 * rotation into the pixels, so the output carries no turn flag. `measured` is required when the plan
 * normalizes loudness (pass 2 of loudnorm).
 */
export function encodeArgs(input: string, out: string, p: FixPlan, measured?: LoudnormMeasurement): string[] {
  if (p.loudness && !measured) throw new Error("encodeArgs: loudness plan needs the pass-1 measurement");
  const tail = [...META, "-movflags", "+faststart", "-y", out];
  const audioFilter = p.loudness ? `${loudnormApply(measured!)},aresample=48000` : "aresample=48000";

  if (!p.reencodeVideo) {
    const audio = !p.hasAudio ? [] : p.loudness ? ["-map", "0:a:0", "-af", audioFilter, ...AAC] : ["-map", "0:a:0", "-c:a", "copy"];
    return ["-hide_banner", "-nostats", "-i", input, "-map", "0:v:0", "-c:v", "copy", ...audio, "-sn", "-dn", ...tail];
  }

  const graph: string[] = [];
  const whole = isWhole(p);
  let v = "[0:v:0]";
  let a = "[0:a:0]";
  if (!whole) {
    const vParts = p.keep.map((k, i) => `[0:v:0]trim=start=${k.start}:end=${k.end},setpts=PTS-STARTPTS[v${i}]`);
    const aParts = p.hasAudio ? p.keep.map((k, i) => `[0:a:0]atrim=start=${k.start}:end=${k.end},asetpts=PTS-STARTPTS[a${i}]`) : [];
    graph.push(...vParts, ...aParts);
    if (p.keep.length === 1) {
      v = "[v0]";
      a = "[a0]";
    } else {
      const pairs = p.keep.map((_, i) => (p.hasAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join("");
      graph.push(`${pairs}concat=n=${p.keep.length}:v=1:a=${p.hasAudio ? 1 : 0}${p.hasAudio ? "[v_cat][a_cat]" : "[v_cat]"}`);
      v = "[v_cat]";
      a = "[a_cat]";
    }
  }
  const fps = p.capFps ? `fps=${FIX_LIMITS.maxFps},` : "";
  const W = FIX_LIMITS.padWidth;
  const H = FIX_LIMITS.padHeight;
  if (p.pad) {
    graph.push(
      `${v}${fps}split[v_fg][v_bg]`,
      `[v_bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2[v_blur]`,
      `[v_fg]scale=${W}:${H}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2[v_top]`,
      `[v_blur][v_top]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v_out]`,
    );
  } else {
    graph.push(`${v}${fps}scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p[v_out]`);
  }
  if (p.hasAudio) graph.push(`${a}${audioFilter}[a_out]`);
  return [
    "-hide_banner",
    "-nostats",
    "-i",
    input,
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[v_out]",
    ...(p.hasAudio ? ["-map", "[a_out]", ...AAC] : []),
    ...X264,
    ...tail,
  ];
}

export interface FixStats {
  durationS: number;
  /** Integrated loudness (LUFS); null when there's no audio or it's silent. */
  loudnessLufs: number | null;
  videoCodec: string | null;
  width: number;
  height: number;
  sizeBytes: number;
}

/** A refusal or failure in plain words (stored in media_fixes.error). `code` lets the worker alert on a missing ffmpeg once. */
export class FixError extends Error {
  constructor(
    message: string,
    readonly code: "refused" | "timeout" | "ffmpeg-failed" | "ffmpeg-missing" | "unsafe" = "ffmpeg-failed",
  ) {
    super(message);
    this.name = "FixError";
  }
}

export const FFMPEG_MISSING_MESSAGE = "ffmpeg is not installed in the worker";

async function ffmpeg(args: string[], timeoutMs: number) {
  const r = await runChecked("ffmpeg", args, { timeoutMs });
  if (r.missing) throw new FixError(FFMPEG_MISSING_MESSAGE, "ffmpeg-missing");
  if (r.timedOut) throw new FixError("The fix took too long and was stopped. Nothing was changed.", "timeout");
  return r;
}

async function measureLoudness(path: string, timeoutMs: number): Promise<number | null> {
  const r = await ffmpeg(["-hide_banner", "-nostats", "-i", path, "-vn", "-map", "0:a:0?", "-af", loudnormMeasure(), "-f", "null", "-"], timeoutMs);
  const v = parseLoudnormMeasurement(r.stderr)?.inputIntegrated;
  return v !== undefined && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

export async function fileStats(path: string, timeoutMs: number = FIX_LIMITS.timeoutMs): Promise<FixStats> {
  const p = await probe(path);
  const turned = p.rotation === 90 || p.rotation === 270;
  return {
    durationS: Math.round(p.durationS * 1000) / 1000,
    loudnessLufs: p.hasAudio ? await measureLoudness(path, timeoutMs) : null,
    videoCodec: p.videoCodec ?? null,
    width: turned ? p.height : p.width,
    height: turned ? p.width : p.height,
    sizeBytes: statSync(path).size,
  };
}

/**
 * Runs a plan: [loudness pass 1] → encode into `outPath` (time-boxed, killed after `timeoutMs`) →
 * checks the result (≥ 1 s, ≤ 30% shorter, no location tags). Throws FixError in plain words; a failed
 * run removes its own half-written output. Never writes to `inputPath`.
 */
export async function runFix(inputPath: string, outPath: string, plan: FixPlan, opts: { timeoutMs?: number } = {}): Promise<{ before: FixStats; after: FixStats }> {
  const timeoutMs = opts.timeoutMs ?? FIX_LIMITS.timeoutMs;
  if (resolve(inputPath) === resolve(outPath)) throw new FixError("The fix must write a new file, never over the original.", "unsafe");
  if (plan.refusal) throw new FixError(plan.refusal, "refused");
  if (existsSync(outPath)) throw new FixError("The output file already exists; nothing was overwritten.", "unsafe");
  try {
    const before = await fileStats(inputPath, timeoutMs);
    let measured: LoudnormMeasurement | undefined;
    if (plan.loudness) {
      const r = await ffmpeg(loudnessMeasureArgs(inputPath, plan), timeoutMs);
      measured = parseLoudnormMeasurement(r.stderr);
      if (!measured || !Number.isFinite(measured.inputIntegrated)) throw new FixError("Couldn't measure the sound, so nothing was changed.");
    }
    const r = await ffmpeg(encodeArgs(inputPath, outPath, plan, measured), timeoutMs);
    if (r.code !== 0 || !existsSync(outPath) || statSync(outPath).size === 0) throw new FixError("ffmpeg couldn't process this clip. Nothing was changed.");
    const after = await fileStats(outPath, timeoutMs);
    if (after.durationS < FIX_LIMITS.minDurationS) throw new FixError("The fixed clip came out shorter than 1 second, so it was not kept.", "refused");
    if (before.durationS > 0 && before.durationS - after.durationS > FIX_LIMITS.maxCutShare * before.durationS + 0.1)
      throw new FixError("The fixed clip came out more than 30% shorter, so it was not kept.", "refused");
    const lingering = await probeLocationTagKeys(outPath);
    if (lingering.length) throw new FixError("Location details survived the fix, so it was not kept.", "unsafe");
    return { before, after };
  } catch (err) {
    rmSync(outPath, { force: true }); // only the file this run wrote
    throw err instanceof FixError ? err : new FixError(`The fix failed: ${String((err as Error)?.message ?? err).split("\n")[0]!.slice(0, 120)}`);
  }
}
