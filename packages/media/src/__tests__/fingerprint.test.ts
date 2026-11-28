import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FINGERPRINT_FRACTIONS, fingerprintFrameArgs, grabFingerprintFrames } from "../fingerprint.js";

const HAS_FFMPEG = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("fingerprint frames (F26 A)", () => {
  it("args: fast seek, first video stream only, 9×8 grey raw to stdout, no file written", () => {
    const a = fingerprintFrameArgs("/tmp/in.mp4", 1.23456);
    expect(a.slice(a.indexOf("-ss"), a.indexOf("-ss") + 2)).toEqual(["-ss", "1.235"]);
    expect(a.indexOf("-ss")).toBeLessThan(a.indexOf("-i"));
    expect(a).toContain("scale=9:8:flags=area,format=gray");
    expect(a.slice(-5)).toEqual(["-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]);
    expect(a).toEqual(expect.arrayContaining(["-an", "-sn", "-dn", "-nostdin"]));
    expect(fingerprintFrameArgs("x", Number.NaN)).toContain("0");
    expect(FINGERPRINT_FRACTIONS).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
  });

  it.skipIf(!HAS_FFMPEG)("reads 8 frames of 72 bytes from a real clip; an unreadable file gives nulls and never throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fp-test-"));
    try {
      const clip = join(dir, "c.mp4");
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x284:rate=30:duration=2", "-pix_fmt", "yuv420p", clip]);
      const g = await grabFingerprintFrames(clip);
      expect(g.durationS).toBeCloseTo(2, 0);
      expect(g.frames).toHaveLength(8);
      for (const f of g.frames) expect(f?.length).toBe(72);
      const bad = join(dir, "bad.mp4");
      writeFileSync(bad, "not a video");
      expect(await grabFingerprintFrames(bad)).toEqual({ durationS: null, frames: Array(8).fill(null) });
      expect((await grabFingerprintFrames(bad, { durationS: 5 })).frames.every((f) => f === null)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
