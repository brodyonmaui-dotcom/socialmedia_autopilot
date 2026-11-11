import { run } from "./exec.js";
import { parseBlackSegments, parseFreezeSegments, parseLoudnormMeasurement } from "./parse.js";
import { probe, type ProbeResult } from "./probe.js";

export interface QaResult {
  probe: ProbeResult;
  blackSegments: { start: number; end: number }[];
  frozenSegments: { start: number; end: number }[];
  loudness?: { integratedLufs: number; truePeakDb: number };
  warnings: string[];
}

const PLATFORM_LIMITS: Record<string, { maxDurationS: number }> = {
  reels: { maxDurationS: 900 },
  shorts: { maxDurationS: 180 },
  tiktok: { maxDurationS: 600 },
};

export async function runQa(filePath: string, platform: keyof typeof PLATFORM_LIMITS = "reels"): Promise<QaResult> {
  const probeResult = await probe(filePath);
  const warnings: string[] = [];

  if (probeResult.hasLocationTags) warnings.push("location tags present (will be stripped by touchUp)");
  if (probeResult.width > probeResult.height) warnings.push(`landscape (${probeResult.width}x${probeResult.height}), expected vertical`);
  const limit = PLATFORM_LIMITS[platform];
  if (limit && probeResult.durationS > limit.maxDurationS) warnings.push(`${probeResult.durationS.toFixed(0)}s exceeds ${platform} limit (${limit.maxDurationS}s)`);

  const black = await run("ffmpeg", ["-i", filePath, "-vf", "blackdetect=d=0.1:pic_th=0.98", "-an", "-f", "null", "-"]);
  const blackSegments = parseBlackSegments(black.stderr);
  if (blackSegments.length) warnings.push(`${blackSegments.length} black-frame segment(s)`);

  const freeze = await run("ffmpeg", ["-i", filePath, "-vf", "freezedetect=n=-30dB:d=1", "-an", "-f", "null", "-"]);
  const frozenSegments = parseFreezeSegments(freeze.stderr);
  if (frozenSegments.length) warnings.push(`${frozenSegments.length} frozen-frame segment(s)`);

  let loudness: QaResult["loudness"];
  if (probeResult.hasAudio) {
    const measure = await run("ffmpeg", ["-i", filePath, "-af", "loudnorm=I=-14:TP=-1.5:print_format=json", "-f", "null", "-"]);
    const m = parseLoudnormMeasurement(measure.stderr);
    if (m) {
      loudness = { integratedLufs: m.inputIntegrated, truePeakDb: m.inputTruePeak };
      if (m.inputIntegrated < -35) warnings.push(`effectively silent (${m.inputIntegrated.toFixed(1)} LUFS)`);
    }
  }

  return { probe: probeResult, blackSegments, frozenSegments, loudness, warnings };
}
