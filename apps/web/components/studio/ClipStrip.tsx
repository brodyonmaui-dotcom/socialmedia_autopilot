"use client";
import { useState } from "react";
import { Button, cx, FOCUS, Icon, Select, Thumb } from "../ui/index.js";
import { SPEEDS, type Speed } from "../../lib/studio/edl-types.js";
import { clipLen, fmtTime, type Action, type EClip } from "../../lib/studio/editor-state.js";
import { RangeField, SecField } from "./parts.js";

/** Ordered clip cards (drag to reorder on desktop) + the inspector for the selected clip: trim, speed, move, split, remove. */
export function ClipStrip({ clips, selected, onSelect, dispatch, onSplit }: { clips: EClip[]; selected: string | null; onSelect: (uid: string) => void; dispatch: (a: Action) => void; onSplit: () => void }) {
  const [drag, setDrag] = useState<string | null>(null);
  const sel = clips.find((c) => c.uid === selected) ?? null;
  const i = sel ? clips.indexOf(sel) : -1;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Clips in order">
        {clips.map((c, k) => (
          <li
            key={c.uid}
            draggable
            onDragStart={() => setDrag(c.uid)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag) dispatch({ type: "moveClip", uid: drag, to: k });
              setDrag(null);
            }}
            className="shrink-0"
          >
            <button type="button" onClick={() => onSelect(c.uid)} aria-pressed={sel?.uid === c.uid} aria-label={`Select clip ${k + 1}, ${c.name}`} className={cx("flex w-[72px] flex-col gap-1 rounded-ds-sm border p-1 text-left", FOCUS, sel?.uid === c.uid ? "border-ds-accent bg-ds-raised" : "border-ds-line bg-ds-card hover:bg-ds-raised")}>
              <Thumb mediaId={c.mediaId} alt="" className="w-full" duration={fmtTime(clipLen(c)).replace(/\.\d$/, "")} />
              <span className="ds-num text-[11px] text-ds-muted">{k + 1}{c.speed !== 1 ? ` · ${c.speed}x` : ""}</span>
            </button>
          </li>
        ))}
        {clips.length === 0 ? <li className="py-3 text-[14px] text-ds-muted">No clips yet. Pick some from the Clips tab.</li> : null}
      </ul>
      {sel ? (
        <div className="flex flex-col gap-2 rounded-ds-lg border border-ds-line bg-ds-card p-3" role="group" aria-label={`Clip ${i + 1} settings`}>
          <p className="truncate text-[14px] font-semibold text-ds-text">{i + 1}. {sel.name}</p>
          <div className="grid grid-cols-2 gap-x-3">
            <RangeField label="Start" value={sel.inS} min={0} max={sel.durationS} onChange={(v) => dispatch({ type: "trim", uid: sel.uid, inS: v })} display={`${sel.inS.toFixed(1)} s`} />
            <RangeField label="End" value={sel.outS} min={0} max={sel.durationS} onChange={(v) => dispatch({ type: "trim", uid: sel.uid, outS: v })} display={`${sel.outS.toFixed(1)} s`} />
            <SecField label="Start (s)" value={sel.inS} max={sel.durationS} onChange={(v) => dispatch({ type: "trim", uid: sel.uid, inS: v })} />
            <SecField label="End (s)" value={sel.outS} max={sel.durationS} onChange={(v) => dispatch({ type: "trim", uid: sel.uid, outS: v })} />
          </div>
          <Select label="Speed" value={String(sel.speed)} onChange={(e) => dispatch({ type: "speed", uid: sel.uid, speed: Number(e.target.value) as Speed })}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
          </Select>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onSplit}>Split at playhead</Button>
            <Button variant="icon" aria-label="Move earlier" disabled={i === 0} onClick={() => dispatch({ type: "moveClip", uid: sel.uid, to: i - 1 })}><Icon name="chevronLeft" size={18} /></Button>
            <Button variant="icon" aria-label="Move later" disabled={i === clips.length - 1} onClick={() => dispatch({ type: "moveClip", uid: sel.uid, to: i + 1 })}><Icon name="chevronRight" size={18} /></Button>
            <Button variant="outline" size="sm" tone="danger" onClick={() => dispatch({ type: "removeClip", uid: sel.uid })}>Remove clip</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
