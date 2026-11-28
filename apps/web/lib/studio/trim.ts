/** Pure maths for the drag-trim bar (TrimBar.tsx): pixel <-> seconds, handle clamping, keyboard nudges, filmstrip times. */
import { LIMITS } from "./editor-state.js";

export type Handle = "in" | "out";
export const NUDGE_S = 0.1;
export const NUDGE_BIG_S = 1;
const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Seconds at a pointer x inside a bar [left, left+width]. */
export function xToTime(x: number, left: number, width: number, durationS: number): number {
  if (!(width > 0) || !(durationS > 0)) return 0;
  return r1(clamp((x - left) / width, 0, 1) * durationS);
}

/** Fraction (0..1) of a time along the clip. */
export const timeToFrac = (t: number, durationS: number): number => (durationS > 0 ? clamp(t / durationS, 0, 1) : 0);

/** Move one handle to `t` (0.1 s grid), keeping at least `minS` between the handles and staying inside [0, durationS]. */
export function moveHandle(handle: Handle, t: number, inS: number, outS: number, durationS: number, minS: number = LIMITS.minClipS): { inS: number; outS: number } {
  const v = r1(t);
  if (handle === "in") return { inS: clamp(v, 0, Math.max(0, outS - minS)), outS };
  return { inS, outS: clamp(v, Math.min(durationS, inS + minS), durationS) };
}

/** Arrow keys: ±0.1 s (shift: ±1 s); Home/End jump to the clip edge. Returns null for other keys. */
export function keyTrim(handle: Handle, key: string, shift: boolean, inS: number, outS: number, durationS: number, minS: number = LIMITS.minClipS): { inS: number; outS: number } | null {
  const cur = handle === "in" ? inS : outS;
  const step = shift ? NUDGE_BIG_S : NUDGE_S;
  let t: number;
  if (key === "ArrowLeft" || key === "ArrowDown") t = cur - step;
  else if (key === "ArrowRight" || key === "ArrowUp") t = cur + step;
  else if (key === "Home") t = 0;
  else if (key === "End") t = durationS;
  else return null;
  return moveHandle(handle, t, inS, outS, durationS, minS);
}

/** n frame times centred in n equal slices of the clip. */
export function frameTimes(durationS: number, n: number): number[] {
  if (!(durationS > 0) || n < 1) return [];
  return Array.from({ length: n }, (_, k) => Math.min(durationS - 0.05, ((k + 0.5) / n) * durationS)).map((t) => Math.max(0, Math.round(t * 100) / 100));
}

/** How many filmstrip frames fit: one per ~36 px, 8..10. */
export const frameCount = (widthPx: number): number => clamp(Math.round(widthPx / 36), 8, 10);

/** "0:03.4" style for in/out, "3.4 s" for lengths. */
export const secLabel = (s: number): string => `${r1(s).toFixed(1)} s`;
