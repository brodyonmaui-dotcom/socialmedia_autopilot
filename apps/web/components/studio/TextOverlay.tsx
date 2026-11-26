"use client";
import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { cx, FOCUS } from "../ui/index.js";
import { textLayout } from "../../lib/studio/edl-types.js";
import type { EText } from "../../lib/studio/editor-state.js";
import { dragTo, nudge, resizeTo, SAFE_BOTTOM, SAFE_TOP } from "../../lib/studio/text-geometry.js";
import { previewCss } from "../../lib/studio/text-preview.js";

type Patch = Partial<Omit<EText, "uid">>;
interface Drag { id: string; mode: "move" | "size"; px: number; py: number; x: number; y: number; size: number; w: number; h: number }

/**
 * Texts drawn on the preview frame with the same textLayout the export uses. Touch/mouse drag moves the selected text
 * (pointer capture + touch-action:none so iPhone Safari doesn't scroll), the corner handle resizes, arrow keys nudge.
 * The layer itself ignores pointers; only the texts take them, so the frame underneath stays tappable.
 */
export function TextOverlay({ texts, activeIds, selected, onSelect, onPatch }: { texts: EText[]; activeIds: Set<string>; selected: string | null; onSelect: (uid: string | null) => void; onPatch: (uid: string, patch: Patch) => void }) {
  const drag = useRef<Drag | null>(null);
  const [guide, setGuide] = useState<{ x: boolean; y: boolean } | null>(null);
  const layer = useRef<HTMLDivElement>(null);

  function begin(e: RPointerEvent<HTMLElement>, t: EText, mode: Drag["mode"]) {
    e.stopPropagation();
    const host = layer.current?.getBoundingClientRect();
    if (!host || host.width === 0) return;
    const l = textLayout(t);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    onSelect(t.uid);
    drag.current = { id: t.uid, mode, px: e.clientX, py: e.clientY, x: l.x, y: l.y, size: t.size ?? l.px / 1080, w: host.width, h: host.height };
  }
  function move(e: RPointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    e.preventDefault();
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (d.mode === "move") {
      const r = dragTo(d.x, d.y, dx, dy, d.w, d.h);
      setGuide({ x: r.snapX, y: r.snapY });
      onPatch(d.id, { x: r.x, y: r.y });
    } else {
      onPatch(d.id, { size: resizeTo(d.size, dx, dy, d.w), x: d.x, y: d.y });
    }
  }
  function end(e: RPointerEvent<HTMLElement>) {
    if (!drag.current) return;
    drag.current = null;
    setGuide(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }
  function key(e: KeyboardEvent<HTMLElement>, t: EText) {
    const l = textLayout(t);
    const n = nudge(l.x, l.y, e.key, e.shiftKey);
    if (n) { e.preventDefault(); onPatch(t.uid, n); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(t.uid); }
  }

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0">
      {guide ? (
        <>
          <div className="absolute inset-x-0 border-t border-dashed border-white/70" style={{ top: `${SAFE_TOP * 100}%` }} aria-hidden />
          <div className="absolute inset-x-0 border-t border-dashed border-white/70" style={{ bottom: `${SAFE_BOTTOM * 100}%` }} aria-hidden />
          <div className={cx("absolute inset-y-0 left-1/2 border-l border-dashed", guide.x ? "border-ds-accent" : "border-white/40")} aria-hidden />
          <div className={cx("absolute inset-x-0 top-1/2 border-t border-dashed", guide.y ? "border-ds-accent" : "border-white/40")} aria-hidden />
        </>
      ) : null}
      {texts.map((t) => {
        const isSel = t.uid === selected;
        const shown = activeIds.has(t.uid);
        if (!shown && !isSel) return null;
        const l = textLayout({ ...t, text: t.text.trim() ? t.text : "Your text" });
        const css = previewCss(l);
        return (
          <div
            key={t.uid}
            role="button"
            tabIndex={0}
            aria-label={`Text: ${t.text.trim() || "empty"}. Drag to move, arrow keys nudge.`}
            aria-pressed={isSel}
            onPointerDown={(e) => begin(e, t, "move")}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={(e) => key(e, t)}
            onFocus={() => { if (!isSel) onSelect(t.uid); }}
            className={cx("pointer-events-auto absolute flex cursor-grab touch-none select-none flex-col active:cursor-grabbing", FOCUS, isSel && "outline outline-2 outline-offset-4 outline-ds-accent", !shown && "opacity-50")}
            style={css.box as React.CSSProperties}
          >
            {l.lines.map((ln, i) => <div key={i} style={css.line as React.CSSProperties}>{ln || " "}</div>)}
            {isSel ? (
              <span
                role="slider"
                aria-label="Text size"
                aria-valuemin={3}
                aria-valuemax={16}
                aria-valuenow={Math.round((t.size ?? l.px / 1080) * 100)}
                tabIndex={-1}
                onPointerDown={(e) => begin(e, t, "size")}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                className="absolute -bottom-[26px] -right-[26px] grid size-11 cursor-nwse-resize touch-none place-items-center"
                style={{ fontSize: 0 }}
              >
                <span className="size-3.5 border-2 border-white bg-ds-accent" aria-hidden />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
