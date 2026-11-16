import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../exec.js";
import { makePoster, posterArgs, posterAtSeconds } from "../poster.js";

describe("posterArgs (pure)", () => {
  const args = posterArgs("/in/clean.mp4", "/out/p.jpg", 1);

  it("seeks before the input, takes one frame, writes JPEG at quality 4, overwrites", () => {
    expect(args.slice(0, 5)).toEqual(["-y", "-ss", "1", "-i", "/in/clean.mp4"]);
    expect(args).toContain("-frames:v");
    expect(args[args.indexOf("-frames:v") + 1]).toBe("1");
    expect(args[args.indexOf("-q:v") + 1]).toBe("4");
    expect(args[args.indexOf("-f") + 1]).toBe("image2");
    expect(args.at(-1)).toBe("/out/p.jpg");
  });

  it("strips every bit of metadata (location boundary): no global, stream or chapter metadata survives", () => {
    expect(args[args.indexOf("-map_metadata") + 1]).toBe("-1");
    expect(args[args.indexOf("-map_chapters") + 1]).toBe("-1");
    expect(args).toContain("-an");
    expect(args).toContain("-sn");
    expect(args).toContain("-dn");
    expect(args[args.indexOf("-fflags") + 1]).toBe("+bitexact"); // not even an encoder comment
    expect(args[args.indexOf("-flags:v") + 1]).toBe("+bitexact");
  });

  it("scales so the long side is 640 px, keeping the aspect ratio", () => {
    const vf = args[args.indexOf("-vf") + 1]!;
    expect(vf).toContain("scale=");
    expect(vf).toContain("640");
    expect(vf).toMatch(/force_original_aspect_ratio=decrease/);
  });

  it("formats the seek time without exponent noise", () => {
    expect(posterArgs("a", "b", 0.25)[2]).toBe("0.25");
    expect(posterArgs("a", "b", 0)[2]).toBe("0");
  });
});

describe("posterAtSeconds", () => {
  it("min(1 s, 10% of duration); 0 for unknown or bad durations", () => {
    expect(posterAtSeconds(30)).toBe(1);
    expect(posterAtSeconds(10)).toBe(1);
    expect(posterAtSeconds(4)).toBeCloseTo(0.4);
    expect(posterAtSeconds(0)).toBe(0);
    expect(posterAtSeconds(Number.NaN)).toBe(0);
    expect(posterAtSeconds(-3)).toBe(0);
  });
});

// Real ffmpeg: a tagged synthetic clip in, a small metadata-free JPEG out.
describe("makePoster (integration, needs ffmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "autopilot-poster-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes a 360x640 JPEG for a 1080x1920 clip with no EXIF/GPS and no location string", async () => {
    const src = join(dir, "src.mp4");
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30:duration=2", "-metadata", "location=+37.7749-122.4194/", "-c:v", "libx264", src]);
    const out = join(dir, "p.jpg");
    await makePoster(src, out, { durationS: 2 });
    expect(existsSync(out)).toBe(true);
    const bytes = readFileSync(out);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(statSync(out).size).toBeLessThan(200_000);
    expect(bytes.includes(Buffer.from("Exif"))).toBe(false);
    expect(bytes.includes(Buffer.from("37.7749"))).toBe(false);
    expect(bytes.includes(Buffer.from("Lavc"))).toBe(false);
    const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", out]);
    const s = JSON.parse(stdout).streams[0];
    expect([s.width, s.height]).toEqual([360, 640]);
  }, 30_000);

  it("throws (never writes a half file silently) when ffmpeg can't read the input", async () => {
    await expect(makePoster(join(dir, "missing.mp4"), join(dir, "none.jpg"), { durationS: 5 })).rejects.toThrow(/poster/);
  }, 15_000);
});
