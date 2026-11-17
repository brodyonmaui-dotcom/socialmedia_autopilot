import { describe, expect, it } from "vitest";
import { parseShowinfoPts, parseSilenceSegments } from "../parse.js";
import type { ProbeResult } from "../probe.js";
import { assessQa, buildQaResult, confirmFrozen, fixIssues, qaAfterTouchUp, qaAnalysisArgs, type QaMeasurements } from "../qa.js";

const probe = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  width: 1080,
  height: 1920,
  fps: 30,
  durationS: 20,
  hasAudio: true,
  hasLocationTags: false,
  videoCodec: "h264",
  audioCodec: "aac",
  pixFmt: "yuv420p",
  container: "mov,mp4,m4a,3gp,3g2,mj2",
  rotation: 0,
  bitRate: 8_000_000,
  hasDeviceTags: false,
  ...over,
});
const m = (over: Partial<QaMeasurements> = {}, p: Partial<ProbeResult> = {}): QaMeasurements => ({
  probe: probe(p),
  blackSegments: [],
  frozenSegments: [],
  silenceSegments: [],
  loudness: { integratedLufs: -14.5, truePeakDb: -2 },
  ...over,
});
const codes = (x: QaMeasurements) => assessQa(x).map((i) => `${i.severity}:${i.code}`);

describe("assessQa (pure)", () => {
  it("a normal clip has no issues at all", () => {
    expect(assessQa(m())).toEqual([]);
  });

  it("frozen tail 3 s → fix frozen-tail, fixable, plain sentence", () => {
    const [i] = assessQa(m({ frozenSegments: [{ start: 17, end: 20 }] }));
    expect(i).toMatchObject({ code: "frozen-tail", severity: "fix", fixable: true, detail: "The last 3 seconds are a frozen frame. Fix it trims them off." });
  });

  it("frozen head → frozen-head; a short middle freeze is nothing; a ≥ 5 s middle freeze is info only", () => {
    expect(codes(m({ frozenSegments: [{ start: 0, end: 2.4 }] }))).toEqual(["fix:frozen-head"]);
    expect(codes(m({ frozenSegments: [{ start: 6, end: 9 }] }))).toEqual([]);
    expect(codes(m({ frozenSegments: [{ start: 6, end: 12 }] }))).toEqual(["info:frozen-middle"]);
  });

  it("frozen time over 40% → one fix frozen-middle, NOT fixable, 'Mostly a still image. Re-export it.' (no trims)", () => {
    const issues = assessQa(m({ frozenSegments: [{ start: 0, end: 5 }, { start: 8, end: 12 }] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "frozen-middle", severity: "fix", fixable: false, detail: "Mostly a still image. Re-export it." });
  });

  it("a freeze that is really black frames counts once (as black)", () => {
    expect(codes(m({ blackSegments: [{ start: 0, end: 2.5 }], frozenSegments: [{ start: 0, end: 2.5 }] }))).toEqual(["fix:black-head"]);
  });

  it("black: 1 s head → black-head (singular sentence); tail → black-tail; ≥ 2 s middle → info", () => {
    expect(assessQa(m({ blackSegments: [{ start: 0, end: 1 }] }))[0]!.detail).toBe("The first second is black. Fix it trims it off.");
    expect(codes(m({ blackSegments: [{ start: 19.2, end: 20 }] }))).toEqual(["fix:black-tail"]);
    expect(codes(m({ blackSegments: [{ start: 8, end: 10.5 }] }))).toEqual(["info:black-middle"]);
    expect(codes(m({ blackSegments: [{ start: 8, end: 9 }] }))).toEqual([]);
  });

  it("sound: no stream, -inf or < −50 LUFS → info no-sound; quiet/loud/peaks → fix loudness", () => {
    expect(codes(m({ loudness: undefined }, { hasAudio: false }))).toEqual(["info:no-sound"]);
    expect(codes(m({ loudness: { integratedLufs: Number.NaN, truePeakDb: Number.NaN } }))).toEqual(["info:no-sound"]);
    expect(codes(m({ loudness: { integratedLufs: -55, truePeakDb: -30 } }))).toEqual(["info:no-sound"]);
    expect(assessQa(m({ loudness: { integratedLufs: -30, truePeakDb: -12 } }))[0]!.detail).toBe("The sound is much quieter than normal. Fix it raises it to the usual level.");
    expect(codes(m({ loudness: { integratedLufs: -8, truePeakDb: -2 } }))).toEqual(["fix:loudness"]);
    expect(codes(m({ loudness: { integratedLufs: -14, truePeakDb: -0.2 } }))).toEqual(["fix:loudness"]);
    expect(codes(m({ loudness: { integratedLufs: -17.9, truePeakDb: -1.1 } }))).toEqual([]);
  });

  it("silence: leading/trailing silence is fine; mid gaps ≥ 1.5 s → info silence-gaps (fixable, opt-in)", () => {
    expect(codes(m({ silenceSegments: [{ start: 0, end: 3 }, { start: 18, end: 20 }] }))).toEqual([]);
    const gaps = assessQa(m({ silenceSegments: [{ start: 5, end: 7 }, { start: 10, end: 11 }] }));
    expect(gaps).toEqual([expect.objectContaining({ code: "silence-gaps", severity: "info", fixable: true, segments: [{ start: 5, end: 7 }] })]);
  });

  it("format: HEVC, non-AAC, odd size, > 60 fps, 10-bit, absurd bitrate, MKV → one fix format", () => {
    for (const p of [{ videoCodec: "hevc" }, { audioCodec: "opus" }, { width: 1079 }, { fps: 120 }, { pixFmt: "yuv420p10le" }, { bitRate: 120_000_000 }, { container: "matroska,webm" }]) {
      expect(codes(m({}, p))).toEqual(["fix:format"]);
    }
  });

  it("rotation flag → fix rotation; display size (not coded size) drives the aspect check", () => {
    expect(codes(m({}, { width: 1920, height: 1080, rotation: 90 }))).toEqual(["fix:rotation"]);
  });

  it("aspect: 4:5 and 3:4 → fix aspect (pad); landscape → info only, never fix; square → info", () => {
    expect(codes(m({}, { width: 1080, height: 1350 }))).toEqual(["fix:aspect"]);
    expect(codes(m({}, { width: 1080, height: 1440 }))).toEqual(["fix:aspect"]);
    expect(codes(m({}, { width: 1920, height: 1080 }))).toEqual(["info:landscape"]);
    expect(codes(m({}, { width: 1080, height: 1080 }))).toEqual(["info:square"]);
  });

  it("location or device tags → fix metadata", () => {
    expect(codes(m({}, { hasLocationTags: true }))).toEqual(["fix:metadata"]);
    expect(codes(m({}, { hasDeviceTags: true }))).toEqual(["fix:metadata"]);
  });

  it("buildQaResult: version 2, warnings = fix sentences only; qaAfterTouchUp drops metadata + loudness", () => {
    const qa = buildQaResult(m({ loudness: { integratedLufs: -30, truePeakDb: -10 }, frozenSegments: [{ start: 17, end: 20 }] }, { hasLocationTags: true }), { now: new Date(0) });
    expect(qa.version).toBe(2);
    expect(qa.checkedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(qa.warnings).toHaveLength(3);
    const after = qaAfterTouchUp(qa);
    expect(fixIssues(after.issues).map((i) => i.code)).toEqual(["frozen-tail"]);
    expect(after.warnings).toEqual(["The last 3 seconds are a frozen frame. Fix it trims them off."]);
  });
});

describe("confirmFrozen", () => {
  it("drops a freezedetect candidate where blocks kept changing (moving cursor), keeps a real still", () => {
    const everyFrame = Array.from({ length: 240 }, (_, i) => i / 30);
    expect(confirmFrozen([{ start: 0, end: 8 }], everyFrame, 8)).toEqual([]);
    const tailStill = Array.from({ length: 150 }, (_, i) => i / 30); // frames change until 5 s, then nothing
    expect(confirmFrozen([{ start: 5, end: 8 }], tailStill, 8)).toEqual([{ start: 5, end: 8 }]);
  });

  it("no kept-frame info → the candidates stand", () => {
    expect(confirmFrozen([{ start: 1, end: 4 }], [], 8)).toEqual([{ start: 1, end: 4 }]);
  });
});

describe("parsers + args", () => {
  it("parses silencedetect and showinfo lines", () => {
    expect(parseSilenceSegments("[silencedetect @ 0x1] silence_start: 2.5\n[silencedetect @ 0x1] silence_end: 4.25 | silence_duration: 1.75\nsilence_start: 9", 10)).toEqual([
      { start: 2.5, end: 4.25 },
      { start: 9, end: 10 },
    ]);
    expect(parseShowinfoPts("[Parsed_showinfo_3 @ 0x1] n:   0 pts:      0 pts_time:0       duration\n[Parsed_showinfo_3 @ 0x1] n:   1 pts:    512 pts_time:0.0333333 x")).toEqual([0, 0.0333333]);
  });

  it("one analysis pass with the v2 thresholds; audio filters only when there is audio", () => {
    const a = qaAnalysisArgs("/in.mp4", true).join(" ");
    expect(a).toContain("freezedetect=n=-60dB:d=2");
    expect(a).toContain("blackdetect=d=0.5:pix_th=0.10");
    expect(a).toContain("mpdecimate");
    expect(a).toContain("loudnorm=I=-14");
    expect(qaAnalysisArgs("/in.mp4", false).join(" ")).not.toContain("loudnorm");
  });
});
