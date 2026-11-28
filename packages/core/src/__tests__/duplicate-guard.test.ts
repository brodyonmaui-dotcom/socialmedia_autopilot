import { describe, expect, it } from "vitest";
import {
  buildVideoIndex,
  classifyVideoUse,
  editSecondsOf,
  shortDay,
  videoFamily,
  videoRelation,
  videoUseMessage,
  type ClipSibling,
  type VideoIdentity,
} from "../duplicate-clip.js";
import { dHashFromGray, fingerprintFromFrames, fingerprintsMatch, formatFingerprint, hamming64, matchingFrames, parseFingerprint } from "../video-fingerprint.js";

/** A deterministic 9×8 grey frame with texture (seeded), optionally nudged by `noise`. */
function frame(seed: number, noise = 0): number[] {
  const px: number[] = [];
  let x = seed * 2654435761;
  for (let i = 0; i < 72; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    px.push(Math.max(0, Math.min(255, (x >>> 16) % 256 + (noise ? ((i * 7) % 3) - 1 : 0) * noise)));
  }
  return px;
}
const fpOf = (seed: number, durationS: number, noise = 0) => fingerprintFromFrames(durationS, Array.from({ length: 8 }, (_, i) => frame(seed * 10 + i, noise)))!;

describe("video fingerprint (pure)", () => {
  it("dHash: 64 bits as 16 hex digits; a flat frame is null; bit = left > right", () => {
    const ramp = Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 20); // every left pixel brighter → all ones
    expect(dHashFromGray(ramp)).toBe("ffffffffffffffff");
    const up = Array.from({ length: 72 }, (_, i) => (i % 9) * 20); // every left pixel darker → all zeros
    expect(dHashFromGray(up)).toBe("0000000000000000");
    expect(dHashFromGray(new Array(72).fill(17))).toBeNull(); // black / one colour
    expect(dHashFromGray([1, 2, 3])).toBeNull();
  });

  it("hamming64 counts differing bits across both halves", () => {
    expect(hamming64("ffffffffffffffff", "0000000000000000")).toBe(64);
    expect(hamming64("8000000000000001", "0000000000000000")).toBe(2);
    expect(hamming64("0123456789abcdef", "0123456789abcdef")).toBe(0);
  });

  it("format/parse round-trip; garbage never parses", () => {
    const f = { durationS: 12.345, frames: ["0123456789abcdef", null, "ffffffffffffffff", "0000000000000001", "a".repeat(16), "b".repeat(16), "c".repeat(16), "d".repeat(16)] };
    const text = formatFingerprint(f);
    expect(text).toBe(`v1:12.35:0123456789abcdef,-,ffffffffffffffff,0000000000000001,${"a".repeat(16)},${"b".repeat(16)},${"c".repeat(16)},${"d".repeat(16)}`);
    expect(parseFingerprint(text)).toEqual({ ...f, durationS: 12.35 });
    for (const bad of [null, "", "v2:1:-", "v1:abc:-", "v1:3:-,-", "v1:3:" + "zz".repeat(8) + ",-,-,-,-,-,-,-"]) expect(parseFingerprint(bad)).toBeNull();
  });

  it("match = durations within 1.0 s and ≥ 6 of 8 frames within Hamming 10", () => {
    const a = fpOf(1, 20);
    expect(fingerprintsMatch(a, a)).toBe(true);
    expect(fingerprintsMatch(a, fpOf(1, 20.9))).toBe(true); // re-encode: same frames, duration rounding
    expect(fingerprintsMatch(a, fpOf(1, 21.2))).toBe(false); // > 1 s apart
    expect(fingerprintsMatch(a, fpOf(2, 20))).toBe(false); // a different clip
    // 6 of 8 frames the same, 2 different → still a match; 5 of 8 → not.
    const pa = parseFingerprint(a)!;
    const other = parseFingerprint(fpOf(3, 20))!;
    const six = { durationS: 20, frames: [...pa.frames.slice(0, 6), ...other.frames.slice(6)] };
    const five = { durationS: 20, frames: [...pa.frames.slice(0, 5), ...other.frames.slice(5)] };
    expect(matchingFrames(pa, six)).toBeGreaterThanOrEqual(6);
    expect(fingerprintsMatch(pa, six)).toBe(true);
    expect(fingerprintsMatch(pa, five)).toBe(false);
  });

  it("flat frames never count: two near-black clips don't match", () => {
    const black = fingerprintFromFrames(10, Array.from({ length: 8 }, () => new Array(72).fill(3)));
    expect(black).toBe("v1:10:-,-,-,-,-,-,-,-");
    expect(fingerprintsMatch(black, black)).toBe(false);
  });

  it("fingerprintFromFrames: null without a duration or with fewer than 6 frames read", () => {
    const frames = Array.from({ length: 8 }, (_, i) => frame(i));
    expect(fingerprintFromFrames(null, frames)).toBeNull();
    expect(fingerprintFromFrames(0, frames)).toBeNull();
    expect(fingerprintFromFrames(10, [...frames.slice(0, 5), null, null, null])).toBeNull();
    expect(fingerprintFromFrames(10, frames)).toMatch(/^v1:10:[0-9a-f]{16}(,[0-9a-f-]{1,16}){7}$/);
  });
});

const row = (id: string, over: Partial<VideoIdentity> = {}): VideoIdentity => ({ id, derivedFrom: null, fingerprint: null, sourcePath: null, durationS: 20, newEdits: false, ...over });

describe("same video: lineage, fingerprint, name", () => {
  const ix = buildVideoIndex([
    row("orig", { sourcePath: "C:\\clips\\IMG_0001.MOV", fingerprint: fpOf(1, 20) }),
    row("fix", { derivedFrom: "orig", sourcePath: "C:\\clips\\IMG_0001-fixed.mp4" }), // touch-up copy
    row("fix2", { derivedFrom: "fix" }), // a fix of the fix
    row("reel-sound", { derivedFrom: "orig", newEdits: true }), // reel with a new sound
    row("reel-plain", { derivedFrom: "fix", newEdits: false }), // reel, original audio, no trim
    row("reupload", { sourcePath: "upload.mp4", fingerprint: fpOf(1, 20.4) }), // new hash, same frames
    row("renamed", { sourcePath: "D:/phone/img_0001.mov", durationS: 20.3 }), // same basename (case-insensitive), dur ±0.5
    row("other", { sourcePath: "IMG_0001.MOV", durationS: 31, fingerprint: fpOf(9, 31) }), // same name, different length
    row("studio", { derivedFrom: "orig", parents: ["b-roll"], newEdits: true }),
    row("b-roll", { fingerprint: fpOf(5, 8) }),
  ]);

  it("fixed copies (any depth) and a reel without new edits are the same video", () => {
    expect(videoRelation(ix, "fix", "orig")).toEqual({ relation: "same", why: "lineage" });
    expect(videoRelation(ix, "fix2", "orig")).toEqual({ relation: "same", why: "lineage" });
    expect(videoRelation(ix, "reel-plain", "orig")).toEqual({ relation: "same", why: "lineage" });
    expect(videoRelation(ix, "reel-plain", "fix2")).toEqual({ relation: "same", why: "lineage" }); // siblings share the root
  });

  it("a reel / Studio edit with ≥ 3 s of new edits is derived footage (warn), also against the source's other copies", () => {
    expect(videoRelation(ix, "reel-sound", "orig")).toEqual({ relation: "derived", why: "lineage" });
    expect(videoRelation(ix, "reel-sound", "fix")).toEqual({ relation: "derived", why: "lineage" });
    expect(videoRelation(ix, "studio", "b-roll")).toEqual({ relation: "derived", why: "lineage" }); // every clip of the edit is a parent
    expect(videoRelation(ix, "orig", "b-roll")).toBeNull(); // two sources of one edit are not the same video
  });

  it("a re-upload (new hash) matches by fingerprint; a renamed path by basename + duration", () => {
    expect(videoRelation(ix, "reupload", "orig")).toEqual({ relation: "same", why: "fingerprint" });
    expect(videoRelation(ix, "renamed", "orig")).toEqual({ relation: "same", why: "name" });
    expect(videoRelation(ix, "other", "orig")).toBeNull();
  });

  it("videoFamily collects all of them (self included), and is symmetric", () => {
    const f = videoFamily(ix, "orig");
    expect(Object.fromEntries([...f].map(([k, v]) => [k, v.relation]))).toEqual({
      orig: "same", fix: "same", fix2: "same", "reel-plain": "same", "reel-sound": "derived", studio: "derived", reupload: "same", renamed: "same",
    });
    for (const [k] of f) expect(videoFamily(ix, k).has("orig"), k).toBe(true);
  });

  it("a lineage cycle (bad data) can't loop", () => {
    const loop = buildVideoIndex([row("a", { derivedFrom: "b" }), row("b", { derivedFrom: "a" })]);
    expect(videoRelation(loop, "a", "b")?.relation).toBe("same");
  });
});

describe("editSecondsOf (≥ 3 s of new edits = derived)", () => {
  it("reel: a new/mixed sound counts the whole output; original audio counts only the cut seconds", () => {
    expect(editSecondsOf({ kind: "reel", params: { audio: "replace" }, sourceDurationS: 20, outputDurationS: 20 })).toBe(20);
    expect(editSecondsOf({ kind: "reel", params: { audio: "original", trimStartS: 0, trimEndS: 19 }, sourceDurationS: 20, outputDurationS: 19 })).toBe(1);
    expect(editSecondsOf({ kind: "reel", params: { audio: "original", trimStartS: 2, trimEndS: 15 }, sourceDurationS: 20, outputDurationS: 13 })).toBe(7);
    expect(editSecondsOf({ kind: "reel", params: { audio: "original" }, sourceDurationS: null, outputDurationS: 20 })).toBe(0);
  });

  it("studio: text on screen, a sound, other clips, the first clip's cut seconds", () => {
    const clip = (mediaId: string, inS: number, outS: number, speed = 1) => ({ mediaId, inS, outS, speed });
    expect(editSecondsOf({ kind: "studio", params: { clips: [clip("a", 0, 20)], texts: [], sound: null }, sourceDurationS: 20, outputDurationS: 20 })).toBe(0);
    expect(editSecondsOf({ kind: "studio", params: { clips: [clip("a", 0, 20)], texts: [{ text: "Leg day", startS: 0, endS: 4 }], sound: null }, sourceDurationS: 20, outputDurationS: 20 })).toBe(4);
    expect(editSecondsOf({ kind: "studio", params: { clips: [clip("a", 0, 10), clip("b", 0, 5)], texts: [], sound: null }, sourceDurationS: 20, outputDurationS: 15 })).toBe(15);
    expect(editSecondsOf({ kind: "studio", params: { clips: [clip("a", 0, 20)], texts: [], sound: { soundId: "s" } }, sourceDurationS: 20, outputDurationS: 20 })).toBe(20);
    expect(editSecondsOf({ kind: "studio", params: null, sourceDurationS: 20, outputDurationS: 20 })).toBe(0);
  });
});

describe("classifyVideoUse (the 90-day rule)", () => {
  const NOW = new Date("2026-11-28T12:00:00.000Z");
  const T = { id: "t", mediaId: "m", platform: "instagram" as const, scheduledFor: "2026-12-01T18:00:00.000Z" };
  const sib = (id: string, over: Partial<ClipSibling>): ClipSibling => ({ id, mediaId: "m", platform: "instagram", status: "approved", scheduledFor: "2026-11-20T18:00:00.000Z", ...over });
  const same = () => ({ relation: "same" as const, why: "fingerprint" as const });

  it("block within 90 days (published, scheduled, already-posted reject); warn beyond; failed / plain reject / other platform ignored", () => {
    expect(classifyVideoUse(T, [sib("p", { status: "published" })], same, NOW).level).toBe("block");
    expect(classifyVideoUse(T, [sib("d", { status: "draft", scheduledFor: "2027-02-20T18:00:00.000Z" })], same, NOW).level).toBe("block");
    expect(classifyVideoUse(T, [sib("r", { status: "rejected", alreadyPosted: true })], same, NOW).hit).toMatchObject({ id: "r", wentOut: true, level: "block" });
    expect(classifyVideoUse(T, [sib("old", { status: "published", scheduledFor: "2026-08-01T18:00:00.000Z" })], same, NOW).level).toBe("warn");
    for (const s of [sib("f", { status: "failed" }), sib("x", { status: "rejected" }), sib("y", { platform: "tiktok" }), sib("t", {})]) {
      expect(classifyVideoUse(T, [s], same, NOW).level, s.id).toBeNull();
    }
    expect(classifyVideoUse(T, [sib("o", { mediaId: "other" })], () => null, NOW).level).toBeNull();
  });

  it("derived footage only warns, flags Instagram trials; untimed plans warn", () => {
    const d = classifyVideoUse(T, [sib("p", { status: "published", mediaId: "src" })], () => ({ relation: "derived", why: "lineage" }), NOW);
    expect(d).toMatchObject({ level: "warn", trialIneligible: true });
    expect(videoUseMessage(d, "UTC")).toBe("Uses footage you posted on Instagram on Fri Nov 20 · not as a trial reel (trials need new content)");
    const u = classifyVideoUse(T, [sib("u", { status: "draft", scheduledFor: null })], same, NOW);
    expect(u.level).toBe("warn");
    expect(videoUseMessage(u, "UTC")).toBe("This video is also planned for Instagram (no time yet)");
  });

  it("names a block before a warn, what went out before a plan, then the nearest", () => {
    const r = classifyVideoUse(
      T,
      [sib("old", { status: "published", scheduledFor: "2026-01-01T00:00:00.000Z" }), sib("plan", { status: "approved", scheduledFor: "2026-12-02T18:00:00.000Z" }), sib("out", { status: "published" })],
      same,
      NOW,
    );
    expect(r.hits.map((h) => h.id)).toEqual(["out", "plan", "old"]);
    expect(videoUseMessage(r, "UTC")).toBe("This video was already posted on Instagram on Fri Nov 20");
  });

  it("wentOutOnly (the outbox): plans never hold; unknown / publishing do", () => {
    expect(classifyVideoUse(T, [sib("a", { status: "approved" })], same, NOW, { wentOutOnly: true }).level).toBeNull();
    expect(classifyVideoUse(T, [sib("u", { status: "unknown" })], same, NOW, { wentOutOnly: true }).level).toBe("block");
    expect(classifyVideoUse(T, [sib("p", { status: "publishing" })], same, NOW, { wentOutOnly: true }).level).toBe("block");
  });

  it("untimed target: the reference time is now", () => {
    expect(classifyVideoUse({ ...T, scheduledFor: null }, [sib("p", { status: "published" })], same, NOW).level).toBe("block");
  });

  it("shortDay is the creator-local day", () => {
    expect(shortDay("2026-11-21T03:00:00.000Z", "America/New_York")).toBe("Fri Nov 20");
    expect(shortDay("2026-11-21T03:00:00.000Z", "UTC")).toBe("Sat Nov 21");
  });
});

describe("name rule skips generic file names", () => {
  it("FullSizeRender.mov / video.mp4 / trim copies never match by name alone; real camera names do", () => {
    const ix = buildVideoIndex([
      row("a", { sourcePath: "FullSizeRender.mov" }),
      row("b", { sourcePath: "C:/x/FullSizeRender.mov" }),
      row("c", { sourcePath: "video (2).mp4" }),
      row("d", { sourcePath: "video.mp4" }),
      row("e", { sourcePath: "IMG_1234.MOV" }),
      row("f", { sourcePath: "/u/IMG_1234.MOV" }),
    ]);
    expect(videoRelation(ix, "a", "b")).toBeNull();
    expect(videoRelation(ix, "c", "d")).toBeNull();
    expect(videoRelation(ix, "e", "f")).toEqual({ relation: "same", why: "name" });
  });
});
