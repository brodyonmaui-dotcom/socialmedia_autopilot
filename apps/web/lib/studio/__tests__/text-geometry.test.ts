import { describe, expect, it } from "vitest";
import { dragTo, nudge, presetY, resizeTo, snapPoint } from "../text-geometry.js";

describe("text geometry", () => {
  it("snaps to the centre lines within 2% and clamps to the frame", () => {
    expect(snapPoint(0.51, 0.49)).toMatchObject({ x: 0.5, y: 0.5, snapX: true, snapY: true });
    expect(snapPoint(0.6, 0.9)).toMatchObject({ x: 0.6, y: 0.9, snapX: false, snapY: false });
    expect(snapPoint(-2, 4)).toMatchObject({ x: 0, y: 1 });
  });
  it("drags by pointer distance relative to the frame", () => {
    const r = dragTo(0.5, 0.5, 100, -192, 200, 384);
    expect(r.x).toBe(1);
    expect(r.y).toBe(0);
    expect(dragTo(0.3, 0.3, 20, 38.4, 200, 384)).toMatchObject({ x: 0.4, y: 0.4 });
  });
  it("resizes within 0.03..0.16", () => {
    expect(resizeTo(0.07, 1000, 1000, 200)).toBe(0.16);
    expect(resizeTo(0.07, -1000, -1000, 200)).toBe(0.03);
    expect(resizeTo(0.07, 0, 0, 200)).toBe(0.07);
  });
  it("presets order top < middle < bottom", () => {
    const base = { text: "Hello", style: "bold" as const };
    const a = presetY(base, "top");
    const b = presetY(base, "center");
    const c = presetY(base, "bottom");
    expect(a).toBeLessThan(b);
    expect(b).toBe(0.5);
    expect(c).toBeGreaterThan(b);
  });
  it("nudges with arrows", () => {
    expect(nudge(0.5, 0.5, "ArrowLeft", false)).toEqual({ x: 0.49, y: 0.5 });
    expect(nudge(0.99, 0.5, "ArrowRight", true)).toEqual({ x: 1, y: 0.5 });
    expect(nudge(0.5, 0.5, "a", false)).toBeNull();
  });
});
