/** Studio editor state: one pure reducer + timeline maths (output time <-> clip/source time). No React, no DOM. */
import type { Edl, Speed, TextPosition, TextStyle } from "./edl-types.js";
import { SPEEDS } from "./edl-types.js";

export const LIMITS = { minS: 3, maxS: 90, maxClips: 10, maxTexts: 10, maxTextLen: 80, minClipS: 0.3, maxVolume: 1.5 } as const;

export interface EClip { uid: string; mediaId: string; name: string; durationS: number; inS: number; outS: number; speed: Speed }
export interface EText { uid: string; text: string; startS: number; endS: number; position: TextPosition; style: TextStyle }
export interface ESound { soundId: string; name: string; durationS: number | null; offsetS: number; volume: number }
export interface EditorState {
  clips: EClip[];
  texts: EText[];
  sound: ESound | null;
  originalVolume: number;
  fit: "fill" | "fit";
  coverS: number | null;
  seq: number;
}
export const initialState = (): EditorState => ({ clips: [], texts: [], sound: null, originalVolume: 1, fit: "fill", coverS: null, seq: 0 });

export type Action =
  | { type: "addClip"; mediaId: string; name: string; durationS: number }
  | { type: "removeClip"; uid: string }
  | { type: "moveClip"; uid: string; to: number }
  | { type: "splitAt"; t: number }
  | { type: "trim"; uid: string; inS?: number; outS?: number }
  | { type: "speed"; uid: string; speed: Speed }
  | { type: "addText"; at: number }
  | { type: "editText"; uid: string; patch: Partial<Omit<EText, "uid">> }
  | { type: "deleteText"; uid: string }
  | { type: "setSound"; sound: Omit<ESound, "offsetS" | "volume"> | null }
  | { type: "patchSound"; patch: { offsetS?: number; volume?: number } }
  | { type: "originalVolume"; volume: number }
  | { type: "cover"; t: number | null }
  | { type: "fit"; fit: "fill" | "fit" }
  | { type: "load"; state: EditorState };

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

export const clipLen = (c: Pick<EClip, "inS" | "outS" | "speed">) => (c.outS - c.inS) / c.speed;
export const totalDuration = (s: Pick<EditorState, "clips">): number => r2(s.clips.reduce((a, c) => a + clipLen(c), 0));

export interface Located { index: number; startT: number; localT: number; sourceS: number }
/** Output time -> clip index, the clip's start on the timeline and the source second to show. t at/after the end maps to the last frame. */
export function locate(clips: EClip[], t: number): Located | null {
  if (clips.length === 0) return null;
  let start = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]!;
    const len = clipLen(c);
    if (t < start + len || i === clips.length - 1) {
      const local = clamp(t - start, 0, len);
      return { index: i, startT: start, localT: local, sourceS: c.inS + local * c.speed };
    }
    start += len;
  }
  return null;
}
/** Start of clip `index` on the output timeline. */
export function clipStart(clips: EClip[], index: number): number {
  let s = 0;
  for (let i = 0; i < index && i < clips.length; i++) s += clipLen(clips[i]!);
  return s;
}
/** Inverse of locate: source second inside clip `index` -> output time. */
export function outputTimeOf(clips: EClip[], index: number, sourceS: number): number {
  const c = clips[index];
  if (!c) return 0;
  return clipStart(clips, index) + clamp((sourceS - c.inS) / c.speed, 0, clipLen(c));
}

const uid = (s: EditorState, p: string) => `${p}${s.seq + 1}`;

export function reducer(s: EditorState, a: Action): EditorState {
  switch (a.type) {
    case "addClip": {
      if (s.clips.length >= LIMITS.maxClips || !(a.durationS > 0)) return s;
      const c: EClip = { uid: uid(s, "c"), mediaId: a.mediaId, name: a.name, durationS: r2(a.durationS), inS: 0, outS: r2(a.durationS), speed: 1 };
      return { ...s, clips: [...s.clips, c], seq: s.seq + 1 };
    }
    case "removeClip":
      return { ...s, clips: s.clips.filter((c) => c.uid !== a.uid) };
    case "moveClip": {
      const from = s.clips.findIndex((c) => c.uid === a.uid);
      if (from < 0) return s;
      const to = clamp(Math.round(a.to), 0, s.clips.length - 1);
      if (to === from) return s;
      const next = [...s.clips];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it!);
      return { ...s, clips: next };
    }
    case "splitAt": {
      const loc = locate(s.clips, a.t);
      if (!loc || s.clips.length >= LIMITS.maxClips) return s;
      const c = s.clips[loc.index]!;
      const at = r2(loc.sourceS);
      if (at - c.inS < LIMITS.minClipS || c.outS - at < LIMITS.minClipS) return s;
      const left: EClip = { ...c, outS: at };
      const right: EClip = { ...c, uid: uid(s, "c"), inS: at };
      const next = [...s.clips];
      next.splice(loc.index, 1, left, right);
      return { ...s, clips: next, seq: s.seq + 1 };
    }
    case "trim":
      return {
        ...s,
        clips: s.clips.map((c) => {
          if (c.uid !== a.uid) return c;
          let inS = a.inS == null ? c.inS : clamp(a.inS, 0, c.durationS);
          let outS = a.outS == null ? c.outS : clamp(a.outS, 0, c.durationS);
          if (a.inS != null && outS - inS < LIMITS.minClipS) inS = Math.max(0, outS - LIMITS.minClipS);
          if (a.outS != null && outS - inS < LIMITS.minClipS) outS = Math.min(c.durationS, inS + LIMITS.minClipS);
          return { ...c, inS: r2(inS), outS: r2(outS) };
        }),
      };
    case "speed":
      return SPEEDS.includes(a.speed) ? { ...s, clips: s.clips.map((c) => (c.uid === a.uid ? { ...c, speed: a.speed } : c)) } : s;
    case "addText": {
      if (s.texts.length >= LIMITS.maxTexts) return s;
      const start = r2(Math.max(0, a.at));
      return { ...s, texts: [...s.texts, { uid: uid(s, "t"), text: "", startS: start, endS: r2(start + 3), position: "bottom", style: "bold" }], seq: s.seq + 1 };
    }
    case "editText":
      return {
        ...s,
        texts: s.texts.map((t) => {
          if (t.uid !== a.uid) return t;
          const n = { ...t, ...a.patch };
          n.text = n.text.slice(0, LIMITS.maxTextLen);
          n.startS = r2(Math.max(0, n.startS));
          n.endS = r2(Math.max(n.endS, n.startS + 0.5));
          return n;
        }),
      };
    case "deleteText":
      return { ...s, texts: s.texts.filter((t) => t.uid !== a.uid) };
    case "setSound":
      return { ...s, sound: a.sound ? { ...a.sound, offsetS: 0, volume: 0.8 } : null };
    case "patchSound":
      return s.sound
        ? { ...s, sound: { ...s.sound, offsetS: a.patch.offsetS == null ? s.sound.offsetS : r2(Math.max(0, a.patch.offsetS)), volume: a.patch.volume == null ? s.sound.volume : r2(clamp(a.patch.volume, 0, LIMITS.maxVolume)) } }
        : s;
    case "originalVolume":
      return { ...s, originalVolume: r2(clamp(a.volume, 0, LIMITS.maxVolume)) };
    case "cover":
      return { ...s, coverS: a.t == null ? null : r2(Math.max(0, a.t)) };
    case "fit":
      return { ...s, fit: a.fit };
    case "load":
      return a.state;
  }
}

/** The EDL to send: texts clipped to the output length (and dropped when entirely past it or empty), cover clamped. */
export function toEdl(s: EditorState): Edl {
  const total = totalDuration(s);
  return {
    v: 1,
    fit: s.fit,
    clips: s.clips.map((c) => ({ mediaId: c.mediaId, inS: c.inS, outS: c.outS, speed: c.speed })),
    texts: s.texts
      .filter((t) => t.text.trim() && t.startS < total)
      .map((t) => ({ text: t.text.trim(), startS: t.startS, endS: r2(Math.min(t.endS, total)), position: t.position, style: t.style })),
    sound: s.sound ? { soundId: s.sound.soundId, offsetS: s.sound.offsetS, volume: s.sound.volume } : null,
    originalVolume: s.originalVolume,
    coverS: s.coverS == null ? null : r2(Math.min(s.coverS, Math.max(0, total - 0.1))),
  };
}

/** Why the project can't be exported yet (empty = fine). */
export function problems(s: EditorState): string[] {
  const out: string[] = [];
  const total = totalDuration(s);
  if (s.clips.length === 0) out.push("Add at least one clip.");
  else if (total < LIMITS.minS) out.push(`Make it at least ${LIMITS.minS} seconds (now ${total.toFixed(1)}).`);
  else if (total > LIMITS.maxS) out.push(`Trim it to ${LIMITS.maxS} seconds or less (now ${total.toFixed(1)}).`);
  return out;
}

/** "0:07.5" style counter. */
export function fmtTime(t: number): string {
  const x = Math.max(0, t);
  const m = Math.floor(x / 60);
  return `${m}:${(x - m * 60).toFixed(1).padStart(4, "0")}`;
}

export function activeTexts(texts: EText[], t: number): EText[] {
  return texts.filter((x) => x.text.trim() && t >= x.startS && t < x.endS);
}

/** Restore a saved project, dropping clips/sounds that are no longer available. Anything malformed -> null. */
export function restore(raw: unknown, clipIds: Set<string>, soundIds: Set<string>): EditorState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<EditorState>;
  if (!Array.isArray(o.clips) || !Array.isArray(o.texts)) return null;
  const base = initialState();
  const clips = o.clips.filter((c) => c && clipIds.has(c.mediaId) && c.outS > c.inS);
  return {
    ...base,
    clips,
    texts: o.texts.filter((t) => t && typeof t.text === "string"),
    sound: o.sound && soundIds.has(o.sound.soundId) ? o.sound : null,
    originalVolume: typeof o.originalVolume === "number" ? o.originalVolume : 1,
    fit: o.fit === "fit" ? "fit" : "fill",
    coverS: typeof o.coverS === "number" ? o.coverS : null,
    seq: typeof o.seq === "number" ? o.seq : 1000,
  };
}
