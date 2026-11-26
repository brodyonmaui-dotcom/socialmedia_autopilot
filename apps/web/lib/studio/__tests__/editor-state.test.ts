import { describe, expect, it } from "vitest";
import { activeTexts, clipStart, fmtTime, initialState, locate, outputTimeOf, problems, reducer, restore, toEdl, totalDuration, type Action, type EditorState } from "../editor-state.js";

const run = (acts: Action[], s: EditorState = initialState()) => acts.reduce(reducer, s);
const three = () =>
  run([
    { type: "addClip", mediaId: "a", name: "A", durationS: 10 },
    { type: "addClip", mediaId: "b", name: "B", durationS: 6 },
    { type: "addClip", mediaId: "c", name: "C", durationS: 4 },
  ]);

describe("clips", () => {
  it("adds, totals, removes", () => {
    const s = three();
    expect(totalDuration(s)).toBe(20);
    expect(totalDuration(reducer(s, { type: "removeClip", uid: s.clips[0]!.uid }))).toBe(10);
  });
  it("caps at 10 clips", () => {
    let s = initialState();
    for (let i = 0; i < 12; i++) s = reducer(s, { type: "addClip", mediaId: `m${i}`, name: "x", durationS: 5 });
    expect(s.clips).toHaveLength(10);
  });
  it("reorders", () => {
    const s = three();
    const moved = reducer(s, { type: "moveClip", uid: s.clips[0]!.uid, to: 2 });
    expect(moved.clips.map((c) => c.mediaId)).toEqual(["b", "c", "a"]);
    expect(reducer(moved, { type: "moveClip", uid: moved.clips[0]!.uid, to: -5 })).toBe(moved);
  });
  it("trims with a minimum length and bounds", () => {
    const s = three();
    const id = s.clips[0]!.uid;
    const t = reducer(s, { type: "trim", uid: id, inS: 2, outS: 8 });
    expect([t.clips[0]!.inS, t.clips[0]!.outS]).toEqual([2, 8]);
    const t2 = reducer(t, { type: "trim", uid: id, inS: 9 });
    expect(t2.clips[0]!.outS - t2.clips[0]!.inS).toBeCloseTo(0.3);
    expect(reducer(s, { type: "trim", uid: id, outS: 99 }).clips[0]!.outS).toBe(10);
  });
  it("speed changes duration", () => {
    const s = three();
    expect(totalDuration(reducer(s, { type: "speed", uid: s.clips[0]!.uid, speed: 2 }))).toBe(15);
    expect(totalDuration(reducer(s, { type: "speed", uid: s.clips[0]!.uid, speed: 0.5 }))).toBe(30);
  });
});

describe("split and mapping", () => {
  it("splits at the playhead without changing the total", () => {
    const s = reducer(three(), { type: "splitAt", t: 4 });
    expect(s.clips.map((c) => [c.inS, c.outS])).toEqual([[0, 4], [4, 10], [0, 6], [0, 4]]);
    expect(new Set(s.clips.map((c) => c.uid)).size).toBe(4);
    expect(totalDuration(s)).toBe(20);
  });
  it("refuses a split too close to an edge", () => {
    const s = three();
    expect(reducer(s, { type: "splitAt", t: 0.1 })).toBe(s);
    expect(reducer(s, { type: "splitAt", t: 10 + 0.1 })).toBe(s);
  });
  it("split honours speed", () => {
    let s = run([{ type: "addClip", mediaId: "a", name: "A", durationS: 10 }]);
    s = reducer(s, { type: "speed", uid: s.clips[0]!.uid, speed: 2 });
    s = reducer(s, { type: "splitAt", t: 2 });
    expect(s.clips[0]!.outS).toBe(4);
    expect(totalDuration(s)).toBe(5);
  });
  it("maps output time to clip + source time and back", () => {
    let s = three();
    s = reducer(s, { type: "trim", uid: s.clips[1]!.uid, inS: 1, outS: 5 });
    s = reducer(s, { type: "speed", uid: s.clips[1]!.uid, speed: 2 }); // 2 s long, starts at 10
    expect(clipStart(s.clips, 1)).toBe(10);
    const loc = locate(s.clips, 11)!;
    expect(loc.index).toBe(1);
    expect(loc.sourceS).toBeCloseTo(3);
    expect(outputTimeOf(s.clips, 1, 3)).toBeCloseTo(11);
    expect(locate(s.clips, 12)!.index).toBe(2);
    expect(locate(s.clips, 999)!.index).toBe(2);
    expect(locate([], 1)).toBeNull();
  });
});

describe("texts, sound, misc", () => {
  it("adds text at the playhead + 3 s and edits with clamping", () => {
    let s = reducer(three(), { type: "addText", at: 2 });
    const t = s.texts[0]!;
    expect([t.startS, t.endS]).toEqual([2, 5]);
    s = reducer(s, { type: "editText", uid: t.uid, patch: { text: "x".repeat(100), endS: 1 } });
    expect(s.texts[0]!.text).toHaveLength(80);
    expect(s.texts[0]!.endS).toBeGreaterThan(s.texts[0]!.startS);
    expect(reducer(s, { type: "deleteText", uid: t.uid }).texts).toEqual([]);
  });
  it("sound set/patch/clear and volume clamp", () => {
    let s = reducer(three(), { type: "setSound", sound: { soundId: "s1", name: "Beat", durationS: 30 } });
    s = reducer(s, { type: "patchSound", patch: { volume: 9, offsetS: -3 } });
    expect(s.sound).toMatchObject({ volume: 1.5, offsetS: 0 });
    expect(reducer(s, { type: "setSound", sound: null }).sound).toBeNull();
    expect(reducer(s, { type: "originalVolume", volume: 5 }).originalVolume).toBe(1.5);
  });
  it("builds the EDL: drops empty/late texts, clamps ends and cover", () => {
    let s = three();
    s = reducer(s, { type: "addText", at: 1 });
    s = reducer(s, { type: "editText", uid: s.texts[0]!.uid, patch: { text: " Hi ", endS: 99 } });
    s = reducer(s, { type: "addText", at: 2 });
    s = reducer(s, { type: "addText", at: 50 });
    s = reducer(s, { type: "editText", uid: s.texts[2]!.uid, patch: { text: "late" } });
    s = reducer(s, { type: "cover", t: 500 });
    s = reducer(s, { type: "fit", fit: "fit" });
    const e = toEdl(s);
    expect(e.texts).toEqual([{ text: "Hi", startS: 1, endS: 20, position: "bottom", style: "bold" }]);
    expect(e.coverS).toBe(19.9);
    expect(e.fit).toBe("fit");
    expect(e.clips[0]).toEqual({ mediaId: "a", inS: 0, outS: 10, speed: 1 });
  });
  it("problems by duration", () => {
    expect(problems(initialState())).toHaveLength(1);
    expect(problems(run([{ type: "addClip", mediaId: "a", name: "A", durationS: 2 }]))).toHaveLength(1);
    expect(problems(three())).toEqual([]);
    let s = initialState();
    for (let i = 0; i < 10; i++) s = reducer(s, { type: "addClip", mediaId: "m", name: "x", durationS: 10 });
    expect(problems(s)).toHaveLength(1);
  });
  it("activeTexts, fmtTime", () => {
    const s = reducer(reducer(three(), { type: "addText", at: 1 }), { type: "addText", at: 1 });
    const id = s.texts[0]!.uid;
    const e = reducer(s, { type: "editText", uid: id, patch: { text: "a" } });
    expect(activeTexts(e.texts, 2).map((t) => t.text)).toEqual(["a"]);
    expect(activeTexts(e.texts, 4)).toEqual([]);
    expect(fmtTime(67.25)).toBe("1:07.3");
  });
  it("restores a saved project minus missing media", () => {
    const s = three();
    const r = restore(JSON.parse(JSON.stringify(s)), new Set(["a", "c"]), new Set());
    expect(r!.clips.map((c) => c.mediaId)).toEqual(["a", "c"]);
    expect(restore("nope", new Set(), new Set())).toBeNull();
  });
});
