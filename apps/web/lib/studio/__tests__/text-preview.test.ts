import { describe, expect, it } from "vitest";
import { textLayout } from "../edl-types.js";
import { previewCss } from "../text-preview.js";

describe("previewCss", () => {
  const base = { text: "Hello there", startS: 0, endS: 2, position: "center", style: "bold" } as const;
  it("scales font to the frame width and anchors by align", () => {
    const l = textLayout({ ...base, size: 0.1, x: 0.25, y: 0.4, align: "right" });
    const c = previewCss(l);
    expect(c.box.fontSize).toBe("10cqw");
    expect(c.box.left).toBe("25%");
    expect(c.box.transform).toBe("translate(-100%, -50%)");
  });
  it("draws each look", () => {
    expect(previewCss(textLayout({ ...base, bg: "shadow" })).line.textShadow).toBeTruthy();
    expect(previewCss(textLayout({ ...base, bg: "outline", color: "#000000" })).line.WebkitTextStroke).toContain("#FFFFFF");
    expect(previewCss(textLayout({ ...base, bg: "box", bgColor: "#FF3B30" })).line.backgroundColor).toBe("#FF3B3099");
    expect(previewCss(textLayout({ ...base, bg: "none" })).line).toEqual({ whiteSpace: "pre" });
  });
});
