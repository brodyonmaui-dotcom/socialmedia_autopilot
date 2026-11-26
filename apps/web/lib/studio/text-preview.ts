/** CSS for one text on the preview frame, derived from the shared textLayout so it matches the export. Pure. */
import type { TextLayout } from "./edl-types.js";

type Css = Record<string, string | number>;
const cq = (px: number) => `${Math.round((px / 1080) * 10000) / 100}cqw`;

export interface PreviewCss { box: Css; line: Css; items: "flex-start" | "center" | "flex-end" }

export function previewCss(l: TextLayout): PreviewCss {
  const items = l.align === "left" ? "flex-start" : l.align === "right" ? "flex-end" : "center";
  const tx = l.align === "left" ? "0%" : l.align === "right" ? "-100%" : "-50%";
  const box: Css = {
    left: `${l.x * 100}%`,
    top: `${l.y * 100}%`,
    transform: `translate(${tx}, -50%)`,
    fontSize: cq(l.px),
    lineHeight: cq(l.lineH),
    fontWeight: l.bold ? 800 : 400,
    color: l.color,
    textAlign: l.align,
    alignItems: items,
  };
  const line: Css = { whiteSpace: "pre" };
  if (l.bg === "shadow") line.textShadow = `${cq(3)} ${cq(3)} 0 rgb(0 0 0 / 0.6)`;
  if (l.bg === "outline") {
    line.WebkitTextStroke = `${cq(2 * Math.max(2, Math.round(l.px * 0.07)))} ${l.color.toUpperCase() === "#000000" ? "#FFFFFF" : "#000000"}`;
    line.paintOrder = "stroke fill";
  }
  if (l.bg === "box") {
    line.backgroundColor = `${l.bgColor}99`;
    line.padding = `0 ${cq(l.px * 0.22)}`;
  }
  return { box, line, items };
}
