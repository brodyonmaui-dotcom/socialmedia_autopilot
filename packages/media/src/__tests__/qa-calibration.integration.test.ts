import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fixIssues, runQa } from "../qa.js";
import { HAS_FFMPEG } from "./ffmpeg-available.js";
import { makeClip, type ClipName } from "./synthetic-clips.js";

/**
 * Calibration (touch-up v2): normal clips that tripped the old thresholds must produce ZERO `fix`
 * issues; each defect clip must produce exactly its one expected `fix`. One summary line per clip.
 */
const CASES: Array<[ClipName, string[]]> = [
  ["talking-head", []],
  ["gym-set", []],
  ["music-later", []],
  ["screen-recording", []],
  ["frozen-tail-3s", ["frozen-tail"]],
  ["black-head-1s", ["black-head"]],
  ["quiet-30lufs", ["loudness"]],
  ["hevc", ["format"]],
  ["rotation", ["rotation"]],
];

describe.skipIf(!HAS_FFMPEG)("QA v2 calibration (integration, needs ffmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "autopilot-qa-cal-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.each(CASES)("%s → fix %j", async (name, expected) => {
    const qa = await runQa(await makeClip(dir, name));
    const fixes = fixIssues(qa.issues).map((i) => i.code);
    const info = qa.issues.filter((i) => i.severity === "info").map((i) => i.code);
    const lufs = qa.loudness?.integratedLufs;
    console.log(`calibration ${name}: fix=[${fixes.join(",")}] info=[${info.join(",")}] lufs=${lufs === undefined || !Number.isFinite(lufs) ? "-" : lufs.toFixed(1)} frozen=${qa.frozenSegments.length} black=${qa.blackSegments.length}`);
    expect(qa.version).toBe(2);
    expect(fixes).toEqual(expected);
    expect(qa.warnings).toEqual(fixIssues(qa.issues).map((i) => i.detail));
  }, 60_000);
});
