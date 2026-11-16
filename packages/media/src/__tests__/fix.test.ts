import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { availableOps, defaultOps, encodeArgs, FixError, loudnessMeasureArgs, planFix, runFix, type FixOp } from "../fix.js";
import type { ProbeResult } from "../probe.js";
import { buildQaResult, fixIssues, runQa, type QaMeasurements } from "../qa.js";
import { HAS_FFMPEG } from "./ffmpeg-available.js";
import { makeClip, type ClipName } from "./synthetic-clips.js";

const probe = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  width: 1080, height: 1920, fps: 30, durationS: 20, hasAudio: true, hasLocationTags: false,
  videoCodec: "h264", audioCodec: "aac", pixFmt: "yuv420p", container: "mov,mp4", rotation: 0, bitRate: 8e6, hasDeviceTags: false,
  ...over,
});
const qaOf = (over: Partial<QaMeasurements> = {}, p: Partial<ProbeResult> = {}) =>
  buildQaResult({ probe: probe(p), blackSegments: [], frozenSegments: [], silenceSegments: [], loudness: { integratedLufs: -14, truePeakDb: -3 }, ...over });
const MEAS = { inputIntegrated: -30, inputTruePeak: -12, inputLra: 3, inputThreshold: -40, targetOffset: 0.2 };

describe("planFix (pure)", () => {
  it("frozen tail → trim to the segment start; always strips; one encode step", () => {
    const p = planFix(qaOf({ frozenSegments: [{ start: 17, end: 20 }] }, { hasAudio: false }));
    expect(p.ops).toEqual(["trim", "strip"]);
    expect(p.keep).toEqual([{ start: 0, end: 17 }]);
    expect(p.expectedDurationS).toBe(17);
    expect(p.reencodeVideo).toBe(true);
    expect(p.steps).toEqual(["encode"]);
    expect(p.refusal).toBeNull();
  });

  it("head + tail trims combine (black head and frozen tail)", () => {
    const p = planFix(qaOf({ blackSegments: [{ start: 0, end: 1 }], frozenSegments: [{ start: 17.5, end: 20 }] }));
    expect(p.keep).toEqual([{ start: 1, end: 17.5 }]);
  });

  it("loudness → two passes (measure, then encode), video stream-copied", () => {
    const p = planFix(qaOf({ loudness: { integratedLufs: -30, truePeakDb: -12 } }));
    expect(p.ops).toEqual(["loudness", "strip"]);
    expect(p.steps).toEqual(["measure-loudness", "encode"]);
    expect(p.reencodeVideo).toBe(false);
  });

  it("only fixable ops are honoured; landscape and 'mostly still' are never planned", () => {
    const q = qaOf({ frozenSegments: [{ start: 0, end: 10 }] }, { width: 1920, height: 1080 });
    expect(availableOps(q)).toEqual([]);
    expect(planFix(q, ["trim", "pad", "reencode"] as FixOp[]).ops).toEqual(["strip"]);
  });

  it("silence gaps are opt-in: not in defaultOps, planned only when asked; keeps 0.3 s of each pause", () => {
    const q = qaOf({ silenceSegments: [{ start: 5, end: 8 }] });
    expect(availableOps(q)).toEqual(["remove-gaps"]);
    expect(defaultOps(q)).toEqual([]);
    const p = planFix(q, ["remove-gaps"]);
    expect(p.keep).toEqual([{ start: 0, end: 5.3 }, { start: 7.7, end: 20 }]);
    expect(p.expectedDurationS).toBe(17.6);
  });

  it("guard rails: refuses a > 30% cut and a result under 1 s, in plain words", () => {
    // 7 s of a 20 s clip trimmed = 35%.
    const big = planFix(qaOf({ blackSegments: [{ start: 0, end: 3 }], frozenSegments: [{ start: 16, end: 20 }] }));
    expect(big.refusal).toMatch(/more than 30%/);
    const tiny = planFix(qaOf({ blackSegments: [{ start: 0, end: 0.6 }] }, { durationS: 1.2 }));
    expect(tiny.refusal).toMatch(/shorter than 1 second/);
  });
});

describe("encodeArgs / loudnessMeasureArgs (pure)", () => {
  const plan = (over: Partial<QaMeasurements> = {}, p: Partial<ProbeResult> = {}, ops?: FixOp[]) => planFix(qaOf(over, p), ops);

  it("every output drops all metadata and chapters and uses +faststart; output is last and never the input", () => {
    for (const pl of [plan(), plan({ frozenSegments: [{ start: 17, end: 20 }] }), plan({}, { videoCodec: "hevc" })]) {
      const a = encodeArgs("/in.mov", "/out.mp4", pl);
      expect(a[a.indexOf("-map_metadata") + 1]).toBe("-1");
      expect(a[a.indexOf("-map_chapters") + 1]).toBe("-1");
      expect(a[a.indexOf("-movflags") + 1]).toBe("+faststart");
      expect(a.at(-1)).toBe("/out.mp4");
      expect(a.filter((x) => x === "/in.mov")).toHaveLength(1);
    }
  });

  it("strip only = stream copy", () => {
    const a = encodeArgs("/in", "/out", plan({}, { hasLocationTags: true }));
    expect(a.join(" ")).toContain("-c:v copy");
    expect(a.join(" ")).toContain("-c:a copy");
  });

  it("re-encode: H.264 high, yuv420p, even size, AAC 48 kHz", () => {
    const a = encodeArgs("/in", "/out", plan({}, { videoCodec: "hevc" })).join(" ");
    expect(a).toContain("-c:v libx264 -profile:v high");
    expect(a).toContain("format=yuv420p");
    expect(a).toContain("scale=trunc(iw/2)*2:trunc(ih/2)*2");
    expect(a).toContain("-c:a aac");
    expect(a).toContain("-ar 48000");
  });

  it("trim uses trim/atrim at the plan bounds", () => {
    const a = encodeArgs("/in", "/out", plan({ frozenSegments: [{ start: 17, end: 20 }] })).join(" ");
    expect(a).toContain("trim=start=0:end=17");
    expect(a).toContain("atrim=start=0:end=17");
  });

  it("pad: 1080×1920 with a blurred background of the clip itself", () => {
    const a = encodeArgs("/in", "/out", plan({}, { width: 1080, height: 1350 })).join(" ");
    expect(a).toContain("crop=1080:1920,boxblur");
    expect(a).toContain("overlay=(W-w)/2:(H-h)/2");
  });

  it("loudness: pass 2 feeds the measured values back (linear); pass 1 is audio-only to null", () => {
    const pl = plan({ loudness: { integratedLufs: -30, truePeakDb: -12 } });
    expect(() => encodeArgs("/in", "/out", pl)).toThrow(/measurement/);
    const a = encodeArgs("/in", "/out", pl, MEAS).join(" ");
    expect(a).toContain("measured_I=-30:measured_TP=-12");
    expect(a).toContain("linear=true");
    const m = loudnessMeasureArgs("/in", pl);
    expect(m).toContain("-vn");
    expect(m.slice(-3)).toEqual(["-f", "null", "-"]);
  });
});

describe("runFix guard rails (no ffmpeg needed)", () => {
  const dir = mkdtempSync(join(tmpdir(), "autopilot-fix-guard-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses to write over the input, and refuses a refused plan, without touching anything", async () => {
    const input = join(dir, "in.mp4");
    writeFileSync(input, "x");
    await expect(runFix(input, input, planFix(qaOf()))).rejects.toThrow(/never over the original/);
    const refused = planFix(qaOf({ blackSegments: [{ start: 0, end: 3 }], frozenSegments: [{ start: 16, end: 20 }] }));
    const err = await runFix(input, join(dir, "out.mp4"), refused).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FixError);
    expect((err as FixError).code).toBe("refused");
    expect(existsSync(input)).toBe(true);
  });
});

// One real run per op on a synthetic clip: the issue is gone on the result, the original is untouched.
describe.skipIf(!HAS_FFMPEG)("runFix (integration, needs ffmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "autopilot-fix-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const CASES: Array<[string, ClipName, FixOp[] | undefined, string]> = [
    ["trim", "frozen-tail-3s", undefined, "frozen-tail"],
    ["trim (black head)", "black-head-1s", undefined, "black-head"],
    ["loudness", "quiet-30lufs", undefined, "loudness"],
    ["reencode (format)", "hevc", undefined, "format"],
    ["reencode (rotation bake)", "rotation", undefined, "rotation"],
    ["pad", "four-five", undefined, "aspect"],
    ["strip", "location-tag", undefined, "metadata"],
    ["remove-gaps (opt-in)", "speech-gaps", ["remove-gaps"], "silence-gaps"],
  ];

  it.each(CASES)("%s: %s → %s gone", async (_label, clip, ops, code) => {
    const src = await makeClip(dir, clip);
    const qa = await runQa(src);
    expect(qa.issues.map((i) => i.code)).toContain(code);
    const out = join(dir, `${clip}-fixed.mp4`);
    const plan = planFix(qa, ops);
    const { before, after } = await runFix(src, out, plan);
    const again = await runQa(out);
    console.log(`fix ${clip}: ops=${plan.ops.join("+")} ${before.durationS}s→${after.durationS}s ${before.width}x${before.height}→${after.width}x${after.height} ${before.videoCodec}→${after.videoCodec} lufs ${before.loudnessLufs}→${after.loudnessLufs} fix-after=[${fixIssues(again.issues).map((i) => i.code).join(",")}]`);
    expect(again.issues.map((i) => i.code)).not.toContain(code);
    expect(fixIssues(again.issues)).toEqual([]);
    expect(existsSync(src)).toBe(true);
    expect(again.probe.hasLocationTags).toBe(false);
    expect(again.probe.hasDeviceTags).toBe(false);
  }, 120_000);
});
