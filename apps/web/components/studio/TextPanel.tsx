"use client";
import { Button, Input, Select } from "../ui/index.js";
import type { TextPosition, TextStyle } from "../../lib/studio/edl-types.js";
import { LIMITS, type Action, type EText } from "../../lib/studio/editor-state.js";
import { SecField } from "./parts.js";

/** Text overlays: text, start/end on the output timeline, position (safe zones), style. */
export function TextPanel({ texts, t, dispatch }: { texts: EText[]; t: number; dispatch: (a: Action) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Button variant="outline" disabled={texts.length >= LIMITS.maxTexts} onClick={() => dispatch({ type: "addText", at: t })}>Add text at playhead</Button>
      {texts.length === 0 ? <p className="text-[14px] text-ds-muted">No text yet. It shows between its start and end, clear of the Instagram buttons.</p> : null}
      {texts.map((x, i) => (
        <div key={x.uid} className="flex flex-col gap-2 rounded-ds-lg border border-ds-line bg-ds-card p-3" role="group" aria-label={`Text ${i + 1}`}>
          <Input label="Text" value={x.text} maxLength={LIMITS.maxTextLen} onChange={(e) => dispatch({ type: "editText", uid: x.uid, patch: { text: e.target.value } })} helper={`${x.text.length}/${LIMITS.maxTextLen}`} />
          <div className="grid grid-cols-2 gap-3">
            <SecField label="Shows at (s)" value={x.startS} onChange={(v) => dispatch({ type: "editText", uid: x.uid, patch: { startS: v } })} />
            <SecField label="Hides at (s)" value={x.endS} onChange={(v) => dispatch({ type: "editText", uid: x.uid, patch: { endS: v } })} />
            <Select label="Position" value={x.position} onChange={(e) => dispatch({ type: "editText", uid: x.uid, patch: { position: e.target.value as TextPosition } })}>
              <option value="top">Top</option>
              <option value="center">Middle</option>
              <option value="bottom">Bottom</option>
            </Select>
            <Select label="Style" value={x.style} onChange={(e) => dispatch({ type: "editText", uid: x.uid, patch: { style: e.target.value as TextStyle } })}>
              <option value="bold">Bold</option>
              <option value="plain">Plain</option>
            </Select>
          </div>
          <div><Button variant="ghost" size="sm" tone="danger" onClick={() => dispatch({ type: "deleteText", uid: x.uid })}>Remove text</Button></div>
        </div>
      ))}
    </div>
  );
}
