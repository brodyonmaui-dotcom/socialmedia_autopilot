import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runChecked } from "../exec.js";
import { FixError } from "../fix.js";
import { probe, probeLocationTagKeys } from "../probe.js";
import { planReel, reelArgs, reelAudioGraph, reelLoudnessArgs, REEL_LIMITS, runReel } from "../reel.js";
import { HAS_FFMPEG } from "./ffmpeg-available.js";

const MEAS = { inputIntegrated: -22, inputTruePeak: -6, inputLra: 4, inputThreshold: -32, targetOffset: 0.1 };
const graphOf = (args: string[]) => args[args.indexOf("-filter_complex") + 1]!;

describe("planReel (pure)", () => {
  it("whole clip, sound only: defaults to full length and volume 1", () => {
    const p = planReel({ durationS: 20, audio: "sound" });
    expect(p).toMatchObject({ start: 0, end: 20, durationS: 20, usesSound: true, usesOriginal: false, soundVolume: 1, originalVolume: 1, refusal: null });
  });

  it("trim is applied and an end past the clip is clamped to its length", () => {
    expect(planReel({ durationS: 20, trimStartS: 2.5, trimEndS: 12, audio: "original" })).toMatchObject({ start: 2.5, end: 12, durationS: 9.5, usesSound: false, usesOriginal: true, refusal: null });
    expect(planReel({ durationS: 20, trimStartS: 5, trimEndS: 99, audio: "sound" }).end).toBe(20);
  });

  it("mix: the sound sits under the clip by default; a silent source mixes down to the sound alone", () => {
    expect(planReel({ durationS: 10, audio: "mix" })).toMatchObject({ soundVolume: 0.5, originalVolume: 1, usesSound: true, usesOriginal: true });
    expect(planReel({ durationS: 10, audio: "mix", sourceHasAudio: false })).toMatchObject({ usesSound: true, usesOriginal: false, refusal: null });
  });

  it("refuses: under 3 s, over 90 s, bad trims, volumes outside 0–1.5, original with no sound, unknown length or mode", () => {
    expect(planReel({ durationS: 2, audio: "sound" }).refusal).toMatch(/at least 3 seconds/);
    expect(planReel({ durationS: 20, trimStartS: 10, trimEndS: 12, audio: "sound" }).refusal).toMatch(/at least 3/);
    expect(planReel({ durationS: 120, audio: "sound" }).refusal).toMatch(/at most 90/);
    expect(planReel({ durationS: 20, trimStartS: 30, audio: "sound" }).refusal).toMatch(/start time/);
    expect(planReel({ durationS: 20, trimStartS: -1, audio: "sound" }).refusal).toMatch(/start time/);
    expect(planReel({ durationS: 20, trimStartS: 8, trimEndS: 6, audio: "sound" }).refusal).toMatch(/end time/);
    expect(planReel({ durationS: 20, audio: "mix", soundVolume: 1.6 }).refusal).toMatch(/Volumes/);
    expect(planReel({ durationS: 20, audio: "mix", originalVolume: -0.1 }).refusal).toMatch(/Volumes/);
    expect(planReel({ durationS: 20, audio: "sound", soundVolume: 1.5 }).refusal).toBeNull();
    expect(planReel({ durationS: 20, audio: "original", sourceHasAudio: false }).refusal).toMatch(/no sound/);
    expect(planReel({ durationS: 0, audio: "sound" }).refusal).toMatch(/unknown/);
    expect(planReel({ durationS: 20, audio: "loud" as never }).refusal).toMatch(/Pick how/);
    expect(REEL_LIMITS).toMatchObject({ minDurationS: 3, maxDurationS: 90, maxVolume: 1.5 });
  });
});

describe("reelArgs (pure)", () => {
  const sound = planReel({ durationS: 20, trimStartS: 2, trimEndS: 12, audio: "sound", soundVolume: 0.8 });
  const mix = planReel({ durationS: 20, trimStartS: 2, trimEndS: 12, audio: "mix" });
  const orig = planReel({ durationS: 20, audio: "original", originalVolume: 1.2 });

  it("sound only: looped sound input, cut to length, 0.5 s fade-in and 1 s fade-out, no clip audio", () => {
    const args = reelArgs("in.mp4", "s.m4a", "out.mp4", sound, { measured: MEAS });
    expect(args.slice(0, 8)).toEqual(["-hide_banner", "-nostats", "-i", "in.mp4", "-stream_loop", "-1", "-i", "s.m4a"]);
    const g = graphOf(args);
    expect(g).toContain("[0:v:0]trim=start=2:end=12,setpts=PTS-STARTPTS[v_trim]");
    expect(g).toContain("[1:a:0]atrim=start=0:end=10,");
    expect(g).toContain("volume=0.8");
    expect(g).toContain("afade=t=in:st=0:d=0.5");
    expect(g).toContain("afade=t=out:st=9:d=1[a_mix]");
    expect(g).not.toContain("[0:a:0]");
    expect(g).not.toContain("amix");
    expect(args[args.indexOf("-t") + 1]).toBe("10");
  });

  it("1080×1920 blurred fill (the touch-up pad), H.264 + AAC, metadata and chapters stripped, faststart", () => {
    const args = reelArgs("in.mp4", "s.m4a", "out.mp4", sound, { measured: MEAS });
    const g = graphOf(args);
    expect(g).toContain("[v_trim]split[v_fg][v_bg]");
    expect(g).toContain("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2");
    expect(g).toContain("overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v_out]");
    expect(args.join(" ")).toContain("-map_metadata -1 -map_chapters -1");
    expect(args.join(" ")).toContain("-movflags +faststart");
    expect(args.join(" ")).toContain("-c:v libx264");
    expect(args.join(" ")).toContain("-c:a aac");
    expect(args.join(" ")).toContain("-map [v_out] -map [a_out]");
    expect(args.at(-1)).toBe("out.mp4");
  });

  it("loudnorm pass 2 at -14 LUFS with the pass-1 measurement; without one, loudness is left alone", () => {
    expect(graphOf(reelArgs("in.mp4", "s.m4a", "o.mp4", sound, { measured: MEAS }))).toMatch(/\[a_mix\]loudnorm=I=-14:TP=-1\.5:LRA=11:measured_I=-22:.*linear=true.*,aresample=48000\[a_out\]/);
    expect(graphOf(reelArgs("in.mp4", "s.m4a", "o.mp4", sound))).toContain("[a_mix]aresample=48000[a_out]");
    expect(graphOf(reelArgs("in.mp4", "s.m4a", "o.mp4", sound, { measured: { ...MEAS, inputIntegrated: -Infinity } }))).toContain("[a_mix]aresample=48000[a_out]");
  });

  it("mix: the trimmed clip audio padded to length and amix'ed with the faded sound", () => {
    const g = reelAudioGraph(mix);
    expect(g).toContain("[0:a:0]atrim=start=2:end=12,asetpts=PTS-STARTPTS,");
    expect(g).toContain("apad=whole_dur=10,atrim=end=10,volume=1[a_orig]");
    expect(g).toContain("volume=0.5,afade=t=in:st=0:d=0.5,afade=t=out:st=9:d=1[a_snd]");
    expect(g).toContain("[a_orig][a_snd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a_mix]");
  });

  it("original: no sound input at all", () => {
    const args = reelArgs("in.mp4", null, "o.mp4", orig, { measured: MEAS });
    expect(args).not.toContain("-stream_loop");
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
    expect(graphOf(args)).toContain("volume=1.2[a_mix]");
  });

  it("pass 1 measures the same audio graph; a sound plan without a sound file is a programming error", () => {
    const m = reelLoudnessArgs("in.mp4", "s.m4a", mix);
    expect(graphOf(m)).toBe(`${reelAudioGraph(mix)};[a_mix]loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json[a_m]`);
    expect(m.slice(-3)).toEqual(["-f", "null", "-"]);
    expect(() => reelArgs("in.mp4", null, "o.mp4", sound)).toThrow(/needs a sound/);
  });

  it("caps the frame rate only when asked", () => {
    expect(graphOf(reelArgs("in.mp4", null, "o.mp4", orig, { capFps: true }))).toContain("[v_trim]fps=60,split");
    expect(graphOf(reelArgs("in.mp4", null, "o.mp4", orig))).toContain("[v_trim]split");
  });
});

describe.skipIf(!HAS_FFMPEG)("runReel (real ffmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "autopilot-reel-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const ff = async (args: string[]) => {
    const r = await runChecked("ffmpeg", ["-v", "error", "-y", ...args], { timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(r.stderr.slice(-300));
  };

  it("a 4 s landscape clip (with a location tag) + a 1.5 s tone → a 1080×1920 reel, 3.5 s, no location tag", async () => {
    const clip = join(dir, "clip.mp4");
    const tone = join(dir, "tone.m4a");
    await ff([
      "-f", "lavfi", "-i", "testsrc=s=640x360:r=30:d=4",
      "-f", "lavfi", "-i", "sine=f=220:d=4:sample_rate=48000",
      "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac",
      "-metadata", "location=+48.8584+002.2945/", clip,
    ]); // prettier-ignore
    await ff(["-f", "lavfi", "-i", "sine=f=440:d=1.5:sample_rate=44100", "-c:a", "aac", tone]);
    expect((await probeLocationTagKeys(clip)).length).toBeGreaterThan(0);

    const plan = planReel({ durationS: 4, trimStartS: 0.5, audio: "mix", soundVolume: 0.7 });
    const out = join(dir, "reel.mp4");
    const { after } = await runReel(clip, tone, out, plan);
    expect(after.width).toBe(1080);
    expect(after.height).toBe(1920);
    expect(after.durationS).toBeGreaterThan(3.2);
    expect(after.durationS).toBeLessThan(3.8);
    expect(after.loudnessLufs).not.toBeNull();
    expect(Math.abs(after.loudnessLufs! - -14)).toBeLessThan(3);
    const p = await probe(out);
    expect(p.hasAudio).toBe(true);
    expect(await probeLocationTagKeys(out)).toEqual([]);
    expect(existsSync(clip)).toBe(true);

    // Refusals never write anything.
    await expect(runReel(clip, tone, clip, plan)).rejects.toBeInstanceOf(FixError);
    await expect(runReel(clip, null, join(dir, "x.mp4"), plan)).rejects.toThrow(/needs a sound/);
    await expect(runReel(clip, tone, join(dir, "y.mp4"), planReel({ durationS: 4, trimStartS: 2, audio: "sound" }))).rejects.toThrow(/at least 3/);
    expect(existsSync(join(dir, "x.mp4")) || existsSync(join(dir, "y.mp4"))).toBe(false);
  }, 120_000);
});
