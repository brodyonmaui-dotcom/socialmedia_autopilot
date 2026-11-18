import { run } from "./exec.js";
import { parseBlackSegments, parseFreezeSegments, parseLoudnormMeasurement, parseShowinfoPts, parseSilenceSegments } from "./parse.js";
import { probe, type ProbeResult } from "./probe.js";
import type { QaIssue, Segment } from "./qa-types.js";

export type { QaIssue, QaIssueCode, QaSeverity, Segment } from "./qa-types.js";

/**
 * QA v2 (touch-up): structured issues instead of loose warning strings. Only `fix` issues count as
 * "flagged"; `info` issues are tags ("No sound yet", "Landscape") and never show in Touch-up.
 * Thresholds were calibrated so tripod gym clips, talking heads, music-later (silent) clips and screen
 * recordings come out clean (see qa-calibration.integration.test.ts).
 */

export interface QaLoudness {
  integratedLufs: number;
  truePeakDb: number;
  lra?: number;
  thresholdLufs?: number;
}

/**
 * Stored on media.qa. v1 rows (before touch-up v2) only had probe/segments/loudness/warnings, so every
 * v2 field is optional here; `runQa` always returns a full `QaResultV2`. `warnings` still holds the
 * `fix` sentences so older readers (batch warnings) only see real problems.
 */
export interface QaResult {
  probe: ProbeResult;
  blackSegments: Segment[];
  frozenSegments: Segment[];
  loudness?: QaLoudness;
  warnings: string[];
  version?: number;
  issues?: QaIssue[];
  silenceSegments?: Segment[];
  checkedAt?: string;
}

export interface QaResultV2 extends QaResult {
  version: 2;
  issues: QaIssue[];
  silenceSegments: Segment[];
  checkedAt: string;
}

export const QA_VERSION = 2 as const;

export const QA_THRESHOLDS = {
  /** freezedetect noise floor / min duration: bit-for-bit still frames for ≥ 2 s. */
  freezeNoiseDb: -60,
  freezeMinS: 2,
  /** A segment "touches" an end when it starts/ends within this many seconds of it. */
  edgeS: 0.5,
  /** A middle freeze this long is worth an info tag. */
  frozenMiddleInfoS: 5,
  /** Frozen time over this share of the clip = "mostly a still image" (fix, not auto-fixable). */
  frozenShareFix: 0.4,
  blackMinS: 0.5,
  blackPixTh: 0.1,
  blackMiddleInfoS: 2,
  /** Below this integrated loudness (or no audio stream) = "No sound yet". */
  noSoundLufs: -50,
  targetLufs: -14,
  lufsTolerance: 4,
  maxTruePeakDb: -1,
  /** Mid-clip silence gaps: detector level, min length, and the loudness that counts as speech-level. */
  silenceDb: -40,
  silenceGapMinS: 1.5,
  speechLevelLufs: -35,
  /** 9:16 = 0.5625 width/height. */
  verticalRatio: 9 / 16,
  verticalTolerance: 0.02,
  /** Up to this width/height a source is "near-vertical" (4:5 = 0.8, 3:4 = 0.75): pad-fixable. */
  nearVerticalMax: 0.85,
  maxFps: 60.5,
  maxBitRate: 60_000_000,
} as const;

const PLATFORM_LIMITS: Record<string, { maxDurationS: number; label: string }> = {
  reels: { maxDurationS: 900, label: "Reels" },
  shorts: { maxDurationS: 180, label: "Shorts" },
  tiktok: { maxDurationS: 600, label: "TikTok" },
};

export type QaPlatform = keyof typeof PLATFORM_LIMITS;

/** Everything `assessQa` needs: what ffprobe + one ffmpeg analysis pass measured. */
export interface QaMeasurements {
  probe: ProbeResult;
  blackSegments: Segment[];
  /** Candidate freezes (freezedetect), already confirmed against block changes (see confirmFrozen). */
  frozenSegments: Segment[];
  silenceSegments: Segment[];
  loudness?: QaLoudness;
}

const len = (s: Segment) => Math.max(0, s.end - s.start);
const overlap = (a: Segment, b: Segment) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** "second" / "2 seconds" (rounded; under 1.5 s reads as one second). */
function seconds(s: number): { n: number; phrase: string } {
  const n = Math.max(1, Math.round(s));
  return { n, phrase: n === 1 ? "second" : `${n} seconds` };
}

/** "The first second is" / "The first 3 seconds are". */
function edgeLead(where: "first" | "last", s: number): string {
  const { n, phrase } = seconds(s);
  return `The ${where} ${phrase} ${n === 1 ? "is" : "are"}`;
}

/** "The last 3 seconds are a frozen frame. Fix it trims them off." */
function trimSentence(lead: string, what: string): string {
  return `${lead} ${what}. Fix it trims ${lead.endsWith(" is") ? "it" : "them"} off.`;
}

/** Display size after the rotation is applied (a 90° clip shows width and height swapped). */
export function displaySize(p: Pick<ProbeResult, "width" | "height" | "rotation">): { width: number; height: number } {
  const turned = p.rotation === 90 || p.rotation === 270;
  return turned ? { width: p.height, height: p.width } : { width: p.width, height: p.height };
}

/**
 * freezedetect averages the change over the whole frame, so a moving mouse cursor on a static screen
 * recording reads as "frozen". A freeze only counts where no 8×8 block changed either (mpdecimate kept no
 * frame): `keptPts` are the frames mpdecimate kept. Without keptPts (parse failed) the candidates stand.
 */
export function confirmFrozen(candidates: Segment[], keptPts: number[], durationS: number, minS: number = QA_THRESHOLDS.freezeMinS): Segment[] {
  if (keptPts.length === 0) return candidates;
  const still: Segment[] = [];
  for (let i = 0; i < keptPts.length; i++) {
    const start = keptPts[i]!;
    const end = i + 1 < keptPts.length ? keptPts[i + 1]! : durationS;
    if (end - start >= minS * 0.9) still.push({ start, end });
  }
  const out: Segment[] = [];
  for (const c of candidates) {
    for (const s of still) {
      const start = Math.max(c.start, s.start);
      const end = Math.min(c.end, s.end);
      // A frame of slack: the two filters timestamp the first still frame one frame apart.
      if (end - start >= minS - 0.1) out.push({ start: round3(start), end: round3(end) });
    }
  }
  return out;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The structured issues for one clip (pure). Order: picture, sound, format, metadata, info. */
export function assessQa(m: QaMeasurements, platform: QaPlatform = "reels"): QaIssue[] {
  const T = QA_THRESHOLDS;
  const p = m.probe;
  const dur = p.durationS > 0 ? p.durationS : 0;
  const issues: QaIssue[] = [];
  const touchesHead = (s: Segment) => s.start <= T.edgeS;
  const touchesTail = (s: Segment) => dur > 0 && s.end >= dur - T.edgeS;

  // --- Black frames (≥ 0.5 s) at the ends: trim. In the middle (≥ 2 s): info.
  const black = m.blackSegments.filter((s) => len(s) >= T.blackMinS - 0.01);
  const blackHead = black.filter(touchesHead);
  const blackTail = black.filter((s) => touchesTail(s) && !touchesHead(s));
  if (blackHead.length) issues.push({ code: "black-head", severity: "fix", fixable: true, detail: trimSentence(edgeLead("first", Math.max(...blackHead.map((s) => s.end))), "black"), segments: blackHead });
  if (blackTail.length) issues.push({ code: "black-tail", severity: "fix", fixable: true, detail: trimSentence(edgeLead("last", dur - Math.min(...blackTail.map((s) => s.start))), "black"), segments: blackTail });
  const blackMiddle = black.filter((s) => !touchesHead(s) && !touchesTail(s) && len(s) >= T.blackMiddleInfoS);
  if (blackMiddle.length) issues.push({ code: "black-middle", severity: "info", fixable: false, detail: `Goes black for ${seconds(Math.max(...blackMiddle.map(len))).phrase} in the middle.`, segments: blackMiddle });

  // --- Frozen frames (≥ 2 s, bit-for-bit). A freeze that is mostly black is already the black issue.
  const frozen = m.frozenSegments.filter((s) => len(s) >= T.freezeMinS - 0.1 && black.reduce((n, b) => n + overlap(s, b), 0) < 0.8 * len(s));
  const frozenTotal = frozen.reduce((n, s) => n + len(s), 0);
  if (dur > 0 && frozenTotal > T.frozenShareFix * dur) {
    // Trimming can't save it (the fix would refuse anyway): ask for a re-export instead.
    issues.push({ code: "frozen-middle", severity: "fix", fixable: false, detail: "Mostly a still image. Re-export it.", segments: frozen });
  } else {
    const head = frozen.filter(touchesHead);
    const tail = frozen.filter((s) => touchesTail(s) && !touchesHead(s));
    const trimText = (lead: string) => trimSentence(lead, "a frozen frame");
    if (head.length) issues.push({ code: "frozen-head", severity: "fix", fixable: true, detail: trimText(edgeLead("first", Math.max(...head.map((s) => s.end)))), segments: head });
    if (tail.length) issues.push({ code: "frozen-tail", severity: "fix", fixable: true, detail: trimText(edgeLead("last", dur - Math.min(...tail.map((s) => s.start)))), segments: tail });
    const middle = frozen.filter((s) => !touchesHead(s) && !touchesTail(s) && len(s) >= T.frozenMiddleInfoS);
    if (middle.length) issues.push({ code: "frozen-middle", severity: "info", fixable: false, detail: `Holds still for ${seconds(Math.max(...middle.map(len))).phrase} in the middle.`, segments: middle });
  }

  // --- Sound.
  const lufs = m.loudness?.integratedLufs;
  const silent = !p.hasAudio || lufs === undefined || !Number.isFinite(lufs) || lufs < T.noSoundLufs;
  if (silent) {
    issues.push({ code: "no-sound", severity: "info", fixable: false, detail: "No sound yet." });
  } else {
    const tp = m.loudness?.truePeakDb ?? -99;
    const quiet = lufs < T.targetLufs - T.lufsTolerance;
    const loud = lufs > T.targetLufs + T.lufsTolerance;
    const peaks = Number.isFinite(tp) && tp > T.maxTruePeakDb;
    if (quiet || loud || peaks) {
      const detail = quiet
        ? "The sound is much quieter than normal. Fix it raises it to the usual level."
        : loud
          ? "The sound is much louder than normal. Fix it brings it down to the usual level."
          : "The sound distorts at its loudest moments. Fix it lowers the peaks.";
      issues.push({ code: "loudness", severity: "fix", fixable: true, detail });
    }
    if (lufs >= T.speechLevelLufs && dur > 0) {
      const gaps = m.silenceSegments.filter((s) => s.start > 0.25 && s.end < dur - 0.25 && len(s) >= T.silenceGapMinS);
      if (gaps.length) {
        issues.push({
          code: "silence-gaps",
          severity: "info",
          fixable: true,
          detail: `Has ${gaps.length === 1 ? "a silent pause" : `${gaps.length} silent pauses`} in the middle. Fix it can cut ${gaps.length === 1 ? "it" : "them"} out, which changes the pacing.`,
          segments: gaps,
        });
      }
    }
  }

  // --- Format.
  const odd = (n: number) => n > 0 && n % 2 === 1;
  const formatProblems = [
    p.container !== undefined && !/mp4|mov/.test(p.container),
    p.videoCodec !== undefined && p.videoCodec !== "h264",
    p.hasAudio && p.audioCodec !== undefined && p.audioCodec !== "aac",
    odd(p.width) || odd(p.height),
    p.fps > T.maxFps,
    p.pixFmt !== undefined && p.pixFmt !== "yuv420p" && p.pixFmt !== "yuvj420p",
    (p.bitRate ?? 0) > T.maxBitRate,
  ].some(Boolean);
  if (formatProblems) issues.push({ code: "format", severity: "fix", fixable: true, detail: "The video file is in a format that won't play well everywhere. Fix it converts it to a standard phone video." });
  if (p.rotation && p.rotation !== 0) issues.push({ code: "rotation", severity: "fix", fixable: true, detail: "The video is stored sideways and relies on a turn flag. Fix it turns it upright for good." });

  const { width, height } = displaySize(p);
  if (width > 0 && height > 0) {
    const r = width / height;
    if (r > 1) issues.push({ code: "landscape", severity: "info", fixable: false, detail: "Landscape." });
    else if (r > T.nearVerticalMax) issues.push({ code: "square", severity: "info", fixable: false, detail: "Square." });
    else if (r > T.verticalRatio + T.verticalTolerance)
      issues.push({ code: "aspect", severity: "fix", fixable: true, detail: "The video isn't full-screen tall. Fix it fills the sides with a blurred copy of the clip." });
    else if (r < T.verticalRatio - T.verticalTolerance) issues.push({ code: "tall", severity: "info", fixable: false, detail: "Taller than a normal phone screen." });
  }

  // --- Metadata (the normal ingest strips it; this catches stragglers).
  if (p.hasLocationTags || p.hasDeviceTags) issues.push({ code: "metadata", severity: "fix", fixable: true, detail: "The file still carries phone or location details. Fix it removes them." });

  const limit = PLATFORM_LIMITS[platform];
  if (limit && dur > limit.maxDurationS) issues.push({ code: "too-long", severity: "info", fixable: false, detail: `Longer than ${limit.label} allows (${Math.round(limit.maxDurationS / 60)} min).` });

  return issues;
}

/** Only the issues that count as flagged (shown in Touch-up). */
export function fixIssues(issues: QaIssue[] | undefined): QaIssue[] {
  return (issues ?? []).filter((i) => i.severity === "fix");
}

/** v2 result from measurements (pure). `warnings` = the fix sentences, for older readers. */
export function buildQaResult(m: QaMeasurements, opts: { platform?: QaPlatform; now?: Date } = {}): QaResultV2 {
  const issues = assessQa(m, opts.platform ?? "reels");
  return {
    version: QA_VERSION,
    checkedAt: (opts.now ?? new Date()).toISOString(),
    probe: m.probe,
    blackSegments: m.blackSegments,
    frozenSegments: m.frozenSegments,
    silenceSegments: m.silenceSegments,
    loudness: m.loudness,
    issues,
    warnings: fixIssues(issues).map((i) => i.detail),
  };
}

/**
 * Both laptop ingest flows run `touchUp` right after QA: it strips all metadata (verified by the re-probe)
 * and loudness-normalizes the audio. Those two issues describe the original, not the clean copy that is
 * stored, so they are dropped here (pure).
 */
export function qaAfterTouchUp<T extends QaResult>(qa: T): T {
  if (!qa.issues) return qa;
  const issues = qa.issues.filter((i) => i.code !== "metadata" && i.code !== "loudness");
  return { ...qa, issues, warnings: fixIssues(issues).map((i) => i.detail) };
}

/** The single ffmpeg analysis pass (pure): black + freeze + block-change check on video; silence + loudness on audio. */
export function qaAnalysisArgs(filePath: string, hasAudio: boolean): string[] {
  const T = QA_THRESHOLDS;
  return [
    "-hide_banner",
    "-nostats",
    "-i",
    filePath,
    "-filter_complex",
    `[0:v:0]split[qa_a][qa_b];[qa_a]blackdetect=d=${T.blackMinS}:pix_th=${T.blackPixTh.toFixed(2)},freezedetect=n=${T.freezeNoiseDb}dB:d=${T.freezeMinS}[qa_o];[qa_b]mpdecimate,showinfo,nullsink`,
    "-map",
    "[qa_o]",
    ...(hasAudio ? ["-map", "0:a:0", "-af", `silencedetect=n=${T.silenceDb}dB:d=${T.silenceGapMinS},loudnorm=I=${T.targetLufs}:TP=-1.5:print_format=json`] : []),
    "-f",
    "null",
    "-",
  ];
}

/** Measurements from the analysis pass's stderr (pure). */
export function parseQaAnalysis(stderr: string, p: ProbeResult): QaMeasurements {
  const dur = p.durationS;
  const candidates = parseFreezeSegments(stderr, dur);
  const frozenSegments = candidates.length ? confirmFrozen(candidates, parseShowinfoPts(stderr), dur) : [];
  let loudness: QaLoudness | undefined;
  let silenceSegments: Segment[] = [];
  if (p.hasAudio) {
    const m = parseLoudnormMeasurement(stderr);
    if (m) loudness = { integratedLufs: m.inputIntegrated, truePeakDb: m.inputTruePeak, lra: m.inputLra, thresholdLufs: m.inputThreshold };
    silenceSegments = parseSilenceSegments(stderr, dur);
  }
  return { probe: p, blackSegments: parseBlackSegments(stderr), frozenSegments, silenceSegments, loudness };
}

export async function runQa(filePath: string, platform: QaPlatform = "reels"): Promise<QaResultV2> {
  const probeResult = await probe(filePath);
  const { stderr } = await run("ffmpeg", qaAnalysisArgs(filePath, probeResult.hasAudio));
  return buildQaResult(parseQaAnalysis(stderr, probeResult), { platform });
}
