"use client";
import { Button, cx, FOCUS, SegmentBar, SegmentButton, Textarea } from "../ui/index.js";
import { TEXT_COLORS, textLayout, type TextAlign, type TextLook } from "../../lib/studio/edl-types.js";
import { LIMITS, type Action, type EText } from "../../lib/studio/editor-state.js";
import { presetY, SIZE_MAX, SIZE_MIN } from "../../lib/studio/text-geometry.js";
import { RangeField, SecField, Swatches } from "./parts.js";

const LOOKS: Array<[TextLook, string]> = [["none", "None"], ["shadow", "Shadow"], ["outline", "Outline"], ["box", "Box"]];
const ALIGNS: Array<[TextAlign, string]> = [["left", "Left"], ["center", "Centre"], ["right", "Right"]];
const WEIGHTS: Array<["bold" | "plain", string]> = [["bold", "Bold"], ["plain", "Plain"]];

/** Text overlays. Drag them on the preview; this panel does the rest. The selected one is open, the others are one-line chips. */
export function TextPanel({ texts, t, selected, onSelect, onAdd, onDuplicate, dispatch }: { texts: EText[]; t: number; selected: string | null; onSelect: (uid: string | null) => void; onAdd: () => void; onDuplicate: (uid: string) => void; dispatch: (a: Action) => void }) {
  const full = texts.length >= LIMITS.maxTexts;
  return (
    <div className="flex flex-col gap-3">
      <Button variant="outline" disabled={full} onClick={onAdd}>Add text</Button>
      {texts.length === 0 ? <p className="text-[14px] text-ds-muted">No text yet. Add one, then drag it on the preview. Dashed lines show the area clear of the Instagram buttons.</p> : null}
      {texts.map((x, i) =>
        x.uid === selected ? (
          <TextEditor key={x.uid} x={x} i={i} t={t} full={full} dispatch={dispatch} onDuplicate={onDuplicate} onSelect={onSelect} />
        ) : (
          <button key={x.uid} type="button" onClick={() => onSelect(x.uid)} className={cx("flex min-h-11 items-center justify-between gap-3 rounded-ds-sm border border-ds-line bg-ds-card px-3 text-left hover:border-ds-text", FOCUS)}>
            <span className="min-w-0 truncate text-[14px] font-semibold text-ds-text">{x.text.trim() || "Empty text"}</span>
            <span className="ds-num shrink-0 text-[13px] text-ds-muted">{x.startS.toFixed(1)}–{x.endS.toFixed(1)} s</span>
          </button>
        ),
      )}
    </div>
  );
}

function TextEditor({ x, i, t, full, dispatch, onDuplicate, onSelect }: { x: EText; i: number; t: number; full: boolean; dispatch: (a: Action) => void; onDuplicate: (uid: string) => void; onSelect: (uid: string | null) => void }) {
  const l = textLayout({ ...x, text: x.text.trim() ? x.text : "Text" });
  const patch = (p: Partial<Omit<EText, "uid">>) => dispatch({ type: "editText", uid: x.uid, patch: p });
  const place = (position: EText["position"]) => patch({ position, y: presetY(x, position) });
  const size = x.size ?? l.px / 1080;
  return (
    <div className="flex flex-col gap-3 rounded-ds-lg border border-ds-text bg-ds-card p-3" role="group" aria-label={`Text ${i + 1}`}>
      <Textarea label="Text" rows={2} value={x.text} maxLength={LIMITS.maxTextLen} onChange={(e) => patch({ text: e.target.value })} helper={`${x.text.length}/${LIMITS.maxTextLen}. Enter starts a new line.`} />

      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-ds-text">Weight</span>
        <SegmentBar ariaLabel="Weight">
          {WEIGHTS.map(([v, label]) => <SegmentButton key={v} type="button" active={x.style === v} onClick={() => patch({ style: v })}>{label}</SegmentButton>)}
        </SegmentBar>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-ds-text">Look</span>
        <SegmentBar ariaLabel="Look">
          {LOOKS.map(([v, label]) => <SegmentButton key={v} type="button" active={l.bg === v} onClick={() => patch({ bg: v })}>{label}</SegmentButton>)}
        </SegmentBar>
      </div>
      <Swatches label="Colour" colors={TEXT_COLORS} value={l.color} onChange={(c) => patch({ color: c })} />
      {l.bg === "box" ? <Swatches label="Box colour" colors={TEXT_COLORS} value={l.bgColor} onChange={(c) => patch({ bgColor: c })} /> : null}
      <RangeField label="Size" value={size} min={SIZE_MIN} max={SIZE_MAX} step={0.005} onChange={(v) => patch({ size: v })} display={`${Math.round(size * 100)}%`} />
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-ds-text">Align</span>
        <SegmentBar ariaLabel="Align">
          {ALIGNS.map(([v, label]) => <SegmentButton key={v} type="button" active={l.align === v} onClick={() => patch({ align: v })}>{label}</SegmentButton>)}
        </SegmentBar>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-ds-text">Place</span>
        <div className="grid grid-cols-4 gap-2">
          <Button variant="outline" size="sm" onClick={() => place("top")}>Top</Button>
          <Button variant="outline" size="sm" onClick={() => place("center")}>Middle</Button>
          <Button variant="outline" size="sm" onClick={() => place("bottom")}>Bottom</Button>
          <Button variant="outline" size="sm" onClick={() => patch({ x: 0.5 })}>Centre</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SecField label="Shows at (s)" value={x.startS} onChange={(v) => patch({ startS: v })} />
        <SecField label="Hides at (s)" value={x.endS} onChange={(v) => patch({ endS: v })} />
        <Button variant="outline" size="sm" onClick={() => patch({ startS: t })}>Start at playhead</Button>
        <Button variant="outline" size="sm" onClick={() => patch({ endS: t })}>End at playhead</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" disabled={full} onClick={() => onDuplicate(x.uid)}>Duplicate</Button>
        <Button variant="ghost" size="sm" tone="danger" onClick={() => { dispatch({ type: "deleteText", uid: x.uid }); onSelect(null); }}>Remove text</Button>
      </div>
    </div>
  );
}
