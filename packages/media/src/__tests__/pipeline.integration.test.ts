import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../exec.js";
import { sha256File } from "../hash.js";
import { probe } from "../probe.js";
import { runQa } from "../qa.js";
import { touchUp } from "../touchup.js";

// Exercises the real ffmpeg/ffprobe binaries against a synthetic clip, not just string parsing.
describe("media pipeline (integration, needs ffmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "autopilot-media-test-"));
  const src = join(dir, "src.mp4");
  const clean = join(dir, "clean.mp4");

  beforeAll(async () => {
    await run("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=1080x1920:rate=30:duration=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:duration=2",
      "-metadata",
      "location=+37.7749-122.4194/",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-shortest",
      src,
    ]);
  }, 30_000);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("probe reads real dimensions/duration and detects the location tag", async () => {
    const result = await probe(src);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(result.hasAudio).toBe(true);
    expect(result.hasLocationTags).toBe(true);
  }, 15_000);

  it("runQa flags the location tag as a warning", async () => {
    const result = await runQa(src, "reels");
    expect(result.warnings.some((w) => w.includes("location"))).toBe(true);
    expect(result.loudness).toBeDefined();
  }, 20_000);

  it("touchUp strips the location tag", async () => {
    await touchUp(src, { outPath: clean });
    const result = await probe(clean);
    expect(result.hasLocationTags).toBe(false);
  }, 15_000);

  it("sha256File is deterministic for the same bytes", async () => {
    const [a, b] = await Promise.all([sha256File(src), sha256File(src)]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
