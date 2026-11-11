import { describe, expect, it } from "vitest";
import { parseBlackSegments, parseFreezeSegments, parseLoudnormMeasurement } from "../parse.js";

describe("parseBlackSegments", () => {
  it("extracts start/end pairs from blackdetect stderr", () => {
    const stderr = `
[blackdetect @ 0x1] black_start:0 black_end:1.5 black_duration:1.5
some other line
[blackdetect @ 0x1] black_start:10.2 black_end:10.4 black_duration:0.2
`;
    expect(parseBlackSegments(stderr)).toEqual([
      { start: 0, end: 1.5 },
      { start: 10.2, end: 10.4 },
    ]);
  });

  it("returns an empty array when there are no black segments", () => {
    expect(parseBlackSegments("frame=100 fps=30")).toEqual([]);
  });
});

describe("parseFreezeSegments", () => {
  it("pairs freeze_start/freeze_end lines in order", () => {
    const stderr = `
[freezedetect @ 0x1] freeze_start: 2.000000
[freezedetect @ 0x1] freeze_end: 4.500000
[freezedetect @ 0x1] freeze_start: 20.000000
`;
    expect(parseFreezeSegments(stderr)).toEqual([
      { start: 2, end: 4.5 },
      { start: 20, end: 20 }, // unterminated at EOF: falls back to start
    ]);
  });
});

describe("parseLoudnormMeasurement", () => {
  it("parses the trailing JSON block ffmpeg prints", () => {
    const stderr = `
[Parsed_loudnorm_0 @ 0x1]
{
	"input_i" : "-29.30",
	"input_tp" : "-1.90",
	"input_lra" : "4.20",
	"input_thresh" : "-39.40",
	"output_i" : "-14.00"
}
`;
    expect(parseLoudnormMeasurement(stderr)).toEqual({
      inputIntegrated: -29.3,
      inputTruePeak: -1.9,
      inputLra: 4.2,
      inputThreshold: -39.4,
    });
  });

  it("returns undefined when there's no JSON block", () => {
    expect(parseLoudnormMeasurement("no json here")).toBeUndefined();
  });
});
