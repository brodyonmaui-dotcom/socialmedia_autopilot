/** Pure maths for dragging/resizing text on the preview frame. Fractions of the frame (0..1), no DOM. */
import { textLayout, type EdlText, type TextPosition } from "./edl-types.js";

export const SIZE_MIN = 0.03;
export const SIZE_MAX = 0.16;
export const SNAP = 0.02;
/** Instagram safe zone (fractions of the frame height): keep text between these. */
export const SAFE_TOP = 0.12;
export const SAFE_BOTTOM = 0.22;

export const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
export const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface Snapped { x: number; y: number; snapX: boolean; snapY: boolean }
/** Clamp to the frame and snap to the centre lines within 2%. */
export function snapPoint(x: number, y: number): Snapped {
  const cx = clamp01(x);
  const cy = clamp01(y);
  const snapX = Math.abs(cx - 0.5) <= SNAP;
  const snapY = Math.abs(cy - 0.5) <= SNAP;
  return { x: snapX ? 0.5 : r3(cx), y: snapY ? 0.5 : r3(cy), snapX, snapY };
}

/** New anchor after the pointer moved (dx, dy in CSS px) over a frame of w x h CSS px. */
export function dragTo(startX: number, startY: number, dx: number, dy: number, w: number, h: number): Snapped {
  return snapPoint(startX + (w > 0 ? dx / w : 0), startY + (h > 0 ? dy / h : 0));
}

/** New size (fraction of the width) when the corner handle moves by (dx, dy) CSS px. Dragging down/right grows. */
export function resizeTo(startSize: number, dx: number, dy: number, w: number): number {
  const d = w > 0 ? (dx + dy) / 2 / w : 0;
  return r3(Math.min(SIZE_MAX, Math.max(SIZE_MIN, startSize + d * 0.5)));
}

/** y for the quick Top/Middle/Bottom buttons: the exact preset formula, taken from the shared layout. */
export function presetY(t: Pick<EdlText, "text" | "style"> & Partial<EdlText>, position: TextPosition): number {
  const { x: _x, y: _y, ...rest } = t as EdlText;
  void _x; void _y;
  return r3(textLayout({ ...rest, text: t.text || " ", startS: 0, endS: 1, position }).y);
}

/** Arrow-key nudge (fractions). */
export function nudge(x: number, y: number, key: string, big: boolean): { x: number; y: number } | null {
  const s = big ? 0.05 : 0.01;
  if (key === "ArrowLeft") return { x: r3(clamp01(x - s)), y };
  if (key === "ArrowRight") return { x: r3(clamp01(x + s)), y };
  if (key === "ArrowUp") return { x, y: r3(clamp01(y - s)) };
  if (key === "ArrowDown") return { x, y: r3(clamp01(y + s)) };
  return null;
}
