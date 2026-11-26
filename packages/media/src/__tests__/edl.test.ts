import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { studioFonts, runEdl, makeCoverPoster } from "../edl-run.js";
import { TEXT_COLORS, edlArgs, edlLoudnessArgs, escapeDrawtext, outputDuration, parseEdl, textLayout, wrapText, type Edl, type EdlText } from "../edl.js";
import { runChecked } from "../exec.js";
import { FixError } from "../fix.js";
import { probe, probeLocationTagKeys } from "../probe.js";
import { HAS_FFMPEG } from "./ffmpeg-available.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const S = "33333333-3333-4333-8333-333333333333";
const graphOf = (args: string[]) => args[args.indexOf("-filter_complex") + 1]!;

const base = (over: Record<string, unknown> = {}) => ({
  v: 1,
  fit: "fit",
  clips: [
    { mediaId: A, inS: 1, outS: 5, speed: 1 },
    { mediaId: B, inS: 0, outS: 2, speed: 0.5 },
  ],
  texts: [{ text: "Leg day: 100% effort", startS: 0.5, endS: 3, position: "bottom", style: "bold" }],
  sound: { soundId: S, offsetS: 2, volume: 0.6 },
  originalVolume: 1,
  coverS: 1,
  ...over,
});
const ok = (raw: unknown): Edl => {
  const r = parseEdl(raw);
  if (!r.ok) throw new Error(r.error);
  return r.edl;
};
const bad = (raw: unknown) => {
  const r = parseEdl(raw);
  return r.ok ? null : r.error;
};

describe("parseEdl", () => {
  it("accepts a valid edit (object or JSON) and normalises it", () => {
    const e = ok(base({ extra: "dropped", clips: [{ mediaId: A.toUpperCase(), inS: 1.00049, outS: 5, speed: 1 }] }));
    expect(e.clips[0]).toEqual({ mediaId: A, inS: 1, outS: 5, speed: 1 });
    expect(e).not.toHaveProperty("extra");
    expect(ok(JSON.stringify(base())).texts).toHaveLength(1);
    expect(ok(base({ texts: undefined, sound: null, coverS: null }))).toMatchObject({ texts: [], sound: null, coverS: null });
    expect(ok(base({ texts: [{ text: "  two\r\nlines ", startS: 0, endS: 99, position: "top", style: "plain" }] })).texts[0]).toMatchObject({ text: "two\nlines", endS: 8 });
  });

  it("rejects bad shapes", () => {
    for (const raw of [null, 5, "not json", [], {}, base({ v: 2 })]) expect(bad(raw)).toMatch(/couldn't be read/);
    expect(bad(base({ fit: "zoom" }))).toMatch(/Fit or Fill/);
    expect(bad(base({ clips: [] }))).toMatch(/at least one clip/);
    expect(bad(base({ clips: "x" }))).toMatch(/at least one clip/);
    expect(bad(base({ clips: [{ mediaId: "nope", inS: 0, outS: 4, speed: 1 }] }))).toMatch(/library clip/);
    expect(bad(base({ clips: [{ mediaId: A, inS: "0", outS: 4, speed: 1 }] }))).toMatch(/plain numbers/);
    expect(bad(base({ clips: [{ mediaId: A, inS: -1, outS: 4, speed: 1 }] }))).toMatch(/plain numbers/);
    expect(bad(base({ clips: [{ mediaId: A, inS: 4, outS: 4, speed: 1 }] }))).toMatch(/after the in point/);
    expect(bad(base({ clips: [{ mediaId: A, inS: 0, outS: 4, speed: 3 }] }))).toMatch(/speed/);
    expect(bad(base({ clips: [{ mediaId: A, inS: 0, outS: 4, speed: 1 }, { mediaId: B, inS: 0, outS: 0.05, speed: 1 }] }))).toMatch(/Clip 2 is too short/);
    expect(bad(base({ texts: {} }))).toMatch(/text overlays/);
    expect(bad(base({ texts: [{ text: "", startS: 0, endS: 1, position: "top", style: "bold" }] }))).toMatch(/empty/);
    expect(bad(base({ texts: [{ text: "hi", startS: 2, endS: 1, position: "top", style: "bold" }] }))).toMatch(/after the start/);
    expect(bad(base({ texts: [{ text: "hi", startS: 9, endS: 10, position: "top", style: "bold" }] }))).toMatch(/after the video ends/);
    expect(bad(base({ texts: [{ text: "hi", startS: 0, endS: 1, position: "left", style: "bold" }] }))).toMatch(/top, center or bottom/);
    expect(bad(base({ texts: [{ text: "hi", startS: 0, endS: 1, position: "top", style: "italic" }] }))).toMatch(/bold or plain/);
    expect(bad(base({ texts: [{ text: "a\u0007b", startS: 0, endS: 1, position: "top", style: "bold" }] }))).toMatch(/can't be drawn/);
    expect(bad(base({ sound: { soundId: "x", offsetS: 0, volume: 1 } }))).toMatch(/Pick a sound/);
    expect(bad(base({ sound: { soundId: S, offsetS: -1, volume: 1 } }))).toMatch(/sound start/);
    expect(bad(base({ sound: { soundId: S, offsetS: 0, volume: 1.6 } }))).toMatch(/Volumes/);
    expect(bad(base({ originalVolume: -0.1 }))).toMatch(/Volumes/);
    expect(bad(base({ originalVolume: undefined }))).toMatch(/Volumes/);
    expect(bad(base({ coverS: 8 }))).toMatch(/cover frame/);
  });

  it("limits: 3..90 s, ≤ 10 clips, ≤ 10 texts, text ≤ 80 characters", () => {
    expect(bad(base({ clips: [{ mediaId: A, inS: 0, outS: 2.9, speed: 1 }], texts: [], coverS: null }))).toMatch(/at least 3 seconds/);
    expect(ok(base({ clips: [{ mediaId: A, inS: 0, outS: 3, speed: 1 }], texts: [], coverS: null }))).toBeTruthy();
    expect(bad(base({ clips: [{ mediaId: A, inS: 0, outS: 90.5, speed: 1 }] }))).toMatch(/at most 90/);
    expect(ok(base({ clips: [{ mediaId: A, inS: 0, outS: 180, speed: 2 }] }))).toBeTruthy();
    expect(bad(base({ clips: [{ mediaId: A, inS: 0, outS: 46, speed: 0.5 }] }))).toMatch(/at most 90/);
    const clip = { mediaId: A, inS: 0, outS: 1, speed: 1 };
    expect(ok(base({ clips: Array(10).fill(clip) })).clips).toHaveLength(10);
    expect(bad(base({ clips: Array(11).fill(clip) }))).toMatch(/at most 10 clips/);
    const t = { text: "x", startS: 0, endS: 1, position: "center", style: "plain" };
    expect(ok(base({ texts: Array(10).fill(t) })).texts).toHaveLength(10);
    expect(bad(base({ texts: Array(11).fill(t) }))).toMatch(/at most 10 text/);
    expect(ok(base({ texts: [{ ...t, text: "é".repeat(80) }] }))).toBeTruthy();
    expect(bad(base({ texts: [{ ...t, text: "a".repeat(81) }] }))).toMatch(/over 80/);
  });
});

describe("outputDuration", () => {
  it("is Σ (outS − inS) / speed", () => {
    expect(outputDuration(ok(base()))).toBe(8);
    expect(outputDuration({ clips: [{ mediaId: A, inS: 0, outS: 3, speed: 0.75 }, { mediaId: A, inS: 1, outS: 4, speed: 1.5 }] })).toBe(6);
    expect(outputDuration({ clips: [{ mediaId: A, inS: 0, outS: 10, speed: 1.25 }] })).toBe(8);
  });
});

describe("edlArgs (pure)", () => {
  const inputs = { clipPaths: ["/t/a.mp4", "/t/b.mp4"], soundPath: "/t/s.m4a", fontPath: "/f/Bold.ttf", plainFontPath: "/f/Plain.ttf", outPath: "/t/out.mp4", clipHasAudio: [true, false] };

  it("trim/setpts/atempo per clip, anullsrc for a silent clip, concat, drawtext windows, amix, loudnorm, metadata stripped", () => {
    const e = ok(base());
    const args = edlArgs(e, inputs);
    const g = graphOf(args);
    expect(args.filter((a) => a === "-i")).toHaveLength(3);
    expect(args.slice(args.indexOf("/t/s.m4a") - 3, args.indexOf("/t/s.m4a"))).toEqual(["-stream_loop", "-1", "-i"]);
    expect(g).toContain("[0:v:0]trim=start=1:end=5,setpts=PTS-STARTPTS,fps=30,");
    expect(g).toContain("[1:v:0]trim=start=0:end=2,setpts=(PTS-STARTPTS)/0.5,fps=30,");
    expect(g).toContain("[0:a:0]atrim=start=1:end=5,asetpts=PTS-STARTPTS,aresample");
    expect(g).not.toContain("[1:a:0]"); // clip 2 has no audio track
    expect(g).toMatch(/anullsrc=channel_layout=stereo:sample_rate=48000,[^;]*apad=whole_dur=4,atrim=end=4,asetpts=PTS-STARTPTS\[a1\]/);
    expect(g).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v_cat][a_cat]");
    expect(g).toContain("boxblur=20:2"); // fit = blurred pad
    expect(g).toContain("drawtext=fontfile=\\'/f/Bold.ttf\\':expansion=none:text=\\'Leg day: 100% effort\\'");
    expect(g).toContain("enable='between(t,0.5,3)'");
    expect(g).toContain("fontcolor=#FFFFFF:fontsize=76:box=1:boxcolor=#000000@0.6:boxborderw=17:x='max(0,min(w-text_w,540-text_w/2))':y=1398:enable"); // bottom preset: 78% minus half a 99 px line
    expect(g).toContain("[a_cat]volume=1[a_orig]");
    expect(g).toMatch(/\[2:a:0\]atrim=start=2:end=10,.*volume=0\.6,afade=t=in:st=0:d=0\.3,afade=t=out:st=7:d=1\[a_snd\]/);
    expect(g).toContain("[a_orig][a_snd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a_mix]");
    expect(g).toContain("[a_mix]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a_out]");
    expect(args.join(" ")).toContain("-map_metadata -1 -map_chapters -1");
    expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual(["-t", "8"]);
    expect(args.at(-1)).toBe("/t/out.mp4");
  });

  it("speeds use one atempo (0.5 included); fill crops; no sound / no text / measured loudness variants", () => {
    const e = ok(base({ fit: "fill", clips: [{ mediaId: A, inS: 0, outS: 2, speed: 0.5 }, { mediaId: A, inS: 2, outS: 6, speed: 2 }], texts: [], sound: null, originalVolume: 0.8 }));
    const ins = { clipPaths: ["/t/a.mp4", "/t/a.mp4"], fontPath: "/f/B.ttf", outPath: "/t/o.mp4" };
    const g = graphOf(edlArgs(e, ins, { measured: { inputIntegrated: -20, inputTruePeak: -3, inputLra: 5, inputThreshold: -30, targetOffset: 0.2 } }));
    expect(g).toContain("asetpts=PTS-STARTPTS,atempo=0.5,");
    expect(g).toContain("atempo=2,");
    expect(g).not.toContain("boxblur");
    expect(g).toContain("crop=1080:1920");
    expect(g).toContain("[v_cat]null[v_out]");
    expect(g).toContain("[a_cat]volume=0.8[a_orig];[a_orig]anull[a_mix]");
    expect(g).toContain("measured_I=-20");
    expect(g).not.toContain("amix");
    expect(graphOf(edlArgs(e, ins, { measured: null }))).toContain("[a_mix]aresample=48000[a_out]");
    const pass1 = edlLoudnessArgs(e, ins);
    expect(graphOf(pass1)).toContain("print_format=json[a_m]");
    expect(graphOf(pass1)).not.toContain("[v_out]");
    expect(() => edlArgs(ok(base()), { ...ins, clipPaths: ["/t/a.mp4"] })).toThrow(/one clip path/);
    expect(() => edlArgs(ok(base()), { clipPaths: ["/a", "/b"], fontPath: "/f", outPath: "/o" })).toThrow(/needs a sound/);
  });

  it("escapes drawtext text for both parser levels (quotes, backslash, colon, brackets, separators)", () => {
    expect(escapeDrawtext("plain")).toBe("\\'plain\\'");
    expect(escapeDrawtext("it's")).toBe("\\'it\\'\\\\\\'\\'s\\'");
    expect(escapeDrawtext("a\\b")).toBe("\\'a\\\\b\\'");
    expect(escapeDrawtext("[x],y;z")).toBe("\\'\\[x\\]\\,y\\;z\\'");
    expect(escapeDrawtext("a:b")).toBe("\\'a:b\\'"); // ':' is safe inside the quotes
  });
});

describe("wrapText + per-line drawtext", () => {
  it("wraps at word boundaries (≤ 20 chars), keeps newlines, breaks over-long words", () => {
    expect(wrapText("Leg day: 100% effort")).toEqual(["Leg day: 100% effort"]);
    expect(wrapText("slow and steady wins the race every time")).toEqual(["slow and steady wins", "the race every time"]);
    expect(wrapText("one\ntwo  three")).toEqual(["one", "two three"]);
    expect(wrapText("a".repeat(45))).toEqual(["a".repeat(20), "a".repeat(20), "a".repeat(5)]);
  });
  it("one centred drawtext per line, all in the same time window", () => {
    const e = ok(base({ texts: [{ text: "slow and steady wins the race", startS: 1, endS: 2, position: "top", style: "plain" }] }));
    const g = graphOf(edlArgs(e, { clipPaths: ["/a", "/b"], soundPath: "/s", fontPath: "/B", plainFontPath: "/P", outPath: "/o" }));
    expect(g.match(/drawtext=/g)).toHaveLength(2);
    expect(g.match(/enable='between\(t,1,2\)'/g)).toHaveLength(2);
    expect(g).toContain("fontfile=\\'/P\\'");
    expect(g).toContain("y=230:"); // top: 12% of 1920
  });
});

const T: EdlText = { text: "hi", startS: 0, endS: 1, position: "top", style: "plain" };
const g1 = (t: Partial<EdlText>) => graphOf(edlArgs(ok(base({ texts: [{ ...T, ...t }] })), { clipPaths: ["/a", "/b"], soundPath: "/s", fontPath: "/B", plainFontPath: "/P", outPath: "/o" }));

describe("EDL text v2", () => {
  const withText = (extra: Record<string, unknown>) => bad(base({ texts: [{ ...T, ...extra }] }));
  it("parse accepts the new fields, normalises colours, and leaves old EDLs untouched", () => {
    const t = ok(base({ texts: [{ ...T, x: 0.25, y: 1, size: 0.1, color: "#ffd60a", bg: "outline", bgColor: "#FF3B30", align: "left" }] })).texts[0]!;
    expect(t).toMatchObject({ x: 0.25, y: 1, size: 0.1, color: "#FFD60A", bg: "outline", bgColor: "#FF3B30", align: "left" });
    const old = ok(base({ texts: [T] })).texts[0]!;
    expect(Object.keys(old).sort()).toEqual(["endS", "position", "startS", "style", "text"]);
    expect(TEXT_COLORS).toHaveLength(8);
  });
  it("parse rejects out-of-range numbers, off-palette colours and bad enums", () => {
    expect(withText({ x: -0.1 })).toMatch(/between 0 and 1/);
    expect(withText({ y: 1.1 })).toMatch(/between 0 and 1/);
    expect(withText({ x: "0.5" })).toMatch(/between 0 and 1/);
    expect(withText({ size: 0.02 })).toMatch(/size/);
    expect(withText({ size: 0.17 })).toMatch(/size/);
    expect(withText({ color: "#123456" })).toMatch(/palette/);
    expect(withText({ bgColor: "red" })).toMatch(/palette/);
    expect(withText({ bg: "glow" })).toMatch(/none, shadow, outline or box/);
    expect(withText({ align: "justify" })).toMatch(/left, center or right/);
  });
  it("textLayout defaults for an old text", () => {
    expect(textLayout({ ...T, style: "bold" })).toMatchObject({ px: 76, lineH: 99, x: 0.5, align: "center", color: "#FFFFFF", bg: "box", bgColor: "#000000", bold: true });
    expect(textLayout(T)).toMatchObject({ px: 65, bg: "shadow", bold: false });
    const half = 99 / 2 / 1920;
    expect(textLayout({ ...T, style: "bold", position: "top" }).y).toBeCloseTo(0.12 + half, 3);
    expect(textLayout({ ...T, position: "center" }).y).toBe(0.5);
    expect(textLayout({ ...T, style: "bold", position: "bottom" }).y).toBeCloseTo(0.78 - half, 3);
  });
  it("textLayout wraps by size, shrinks to fit, and clamps", () => {
    const small = textLayout({ ...T, text: "slow and steady wins the race every time", size: 0.03 });
    const big = textLayout({ ...T, text: "slow and steady wins the race every time", size: 0.16 });
    expect(small.lines.length).toBeLessThan(big.lines.length);
    const long = textLayout({ ...T, text: "a".repeat(30), size: 0.16 }); // maxChars 6 -> wraps, never wider than 92%
    expect(Math.max(...long.lines.map((l) => l.length)) * long.px * 0.6).toBeLessThanOrEqual(0.92 * 1080);
    const wide = textLayout({ ...T, text: "WWWWWWWWWWWW", size: 0.16 });
    expect(wide.px).toBeLessThanOrEqual(173);
    const c = textLayout({ ...T, x: 1, y: 0, size: 0.1 });
    expect(c.x).toBe(1);
    expect(c.y).toBeCloseTo((c.lines.length * c.lineH) / 2 / 1920, 3);
    expect(textLayout({ ...T, y: 1 }).y).toBeLessThan(1);
  });
  it("drawtext args per look", () => {
    expect(g1({ bg: "none" })).not.toMatch(/box=1|shadowcolor|borderw/);
    expect(g1({ bg: "shadow" })).toContain("shadowcolor=black@0.6:shadowx=3:shadowy=3");
    expect(g1({ bg: "outline", size: 0.1 })).toContain("borderw=8:bordercolor=black");
    expect(g1({ bg: "outline", color: "#000000" })).toContain("bordercolor=white");
    expect(g1({ bg: "box", bgColor: "#0A84FF", size: 0.1 })).toContain("boxcolor=#0A84FF@0.6:boxborderw=24");
    expect(g1({ color: "#FF2D92" })).toContain("fontcolor=#FF2D92");
  });
  it("drawtext x per align, clamped, y from the layout", () => {
    expect(g1({ align: "left", x: 0.1 })).toContain("x='max(0,min(w-text_w,108))'");
    expect(g1({ align: "right", x: 0.9 })).toContain("x='max(0,min(w-text_w,972-text_w))'");
    expect(g1({ align: "center", x: 0.3 })).toContain("x='max(0,min(w-text_w,324-text_w/2))'");
    const l = textLayout({ ...T, y: 0.5 });
    expect(g1({ y: 0.5 })).toContain(`y=${Math.round(0.5 * 1920 - l.lineH / 2)}:`);
    expect(g1({ font: undefined } as never)).toContain("fontfile=\\'/P\\'");
  });
});

describe("studioFonts", () => {
  it("env override wins; else the first font that exists; else the image default", () => {
    expect(studioFonts({ STUDIO_FONT_PATH: "/x/B.ttf" }, () => false)).toEqual({ bold: "/x/B.ttf", plain: "/x/B.ttf" });
    expect(studioFonts({}, (p) => p.includes("truetype"))).toEqual({ bold: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", plain: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf" });
    expect(studioFonts({}, () => false).bold).toBe("/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf");
  });
});

const FONTS = studioFonts(process.env);
const HAS_FONT = existsSync(FONTS.bold) && existsSync(FONTS.plain);
if (HAS_FFMPEG && !HAS_FONT) console.log("[media tests] no DejaVu font found: skipping the Studio real render (set STUDIO_FONT_PATH)");

describe.skipIf(!HAS_FFMPEG || !HAS_FONT)("runEdl (real ffmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "autopilot-edl-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const ff = async (args: string[]) => {
    const r = await runChecked("ffmpeg", ["-v", "error", "-y", ...args], { timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(r.stderr.slice(-300));
  };

  it("2 generated 2 s clips (one silent, one location-tagged) + tricky text + a tone → 1080x1920, expected length, no location", async () => {
    const a = join(dir, "a.mp4");
    const b = join(dir, "b.mp4");
    const tone = join(dir, "tone.m4a");
    await ff([
      "-f", "lavfi", "-i", "testsrc=s=640x360:r=30:d=2",
      "-f", "lavfi", "-i", "sine=f=220:d=2:sample_rate=48000",
      "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac",
      "-metadata", "location=+48.8584+002.2945/", a,
    ]); // prettier-ignore
    await ff(["-f", "lavfi", "-i", "testsrc2=s=360x640:r=25:d=2", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", b]);
    await ff(["-f", "lavfi", "-i", "sine=f=440:d=1.5:sample_rate=44100", "-c:a", "aac", tone]);
    expect((await probe(b)).hasAudio).toBe(false);
    expect((await probeLocationTagKeys(a)).length).toBeGreaterThan(0);

    const edl = ok({
      v: 1,
      fit: "fit",
      clips: [
        { mediaId: A, inS: 0, outS: 2, speed: 1 },
        { mediaId: B, inS: 0, outS: 1, speed: 0.5 },
        { mediaId: A, inS: 0.5, outS: 2, speed: 1.5 },
      ],
      texts: [
        { text: "it's 100% [done]: a\\b, c;d\nline two", startS: 0.2, endS: 2.5, position: "top", style: "bold" },
        { text: "plain", startS: 3, endS: 4, position: "center", style: "plain" },
        { text: "dragged\nbottom right", startS: 0, endS: 4, position: "top", style: "bold", x: 0.9, y: 0.7, size: 0.1, color: "#FFD60A", bg: "outline", align: "right" },
      ],
      sound: { soundId: S, offsetS: 0.5, volume: 0.7 },
      originalVolume: 1,
      coverS: 1.5,
    });
    const expected = outputDuration(edl); // 2 + 2 + 1
    expect(expected).toBe(5);
    const out = join(dir, "out.mp4");
    const r = await runEdl(edl, { clipPaths: [a, b, a], soundPath: tone, fontPath: FONTS.bold, plainFontPath: FONTS.plain, outPath: out });
    expect(Math.abs(r.durationS - expected)).toBeLessThan(0.3);
    expect(r.after).toMatchObject({ width: 1080, height: 1920 });
    expect(r.after.loudnessLufs).not.toBeNull();
    expect(await probeLocationTagKeys(out)).toEqual([]);
    const jpg = join(dir, "cover.jpg");
    await makeCoverPoster(out, jpg, { durationS: r.durationS, coverS: edl.coverS });
    expect(existsSync(jpg)).toBe(true);

    // Refusals never write anything and never touch the inputs.
    await expect(runEdl(edl, { clipPaths: [a, b, a], soundPath: tone, fontPath: FONTS.bold, outPath: a })).rejects.toBeInstanceOf(FixError);
    const past = ok({ ...edl, clips: [{ mediaId: A, inS: 0, outS: 4, speed: 1 }], texts: [], coverS: null });
    await expect(runEdl(past, { clipPaths: [a], soundPath: tone, fontPath: FONTS.bold, outPath: join(dir, "x.mp4") })).rejects.toThrow(/past the end/);
    expect(existsSync(join(dir, "x.mp4"))).toBe(false);
    expect((await probeLocationTagKeys(a)).length).toBeGreaterThan(0);
  }, 180_000);
});
