"use client";
import { Button, Dialog } from "../ui/index.js";
import { fmtTime, totalDuration, type EditorState } from "../../lib/studio/editor-state.js";

/** Confirm before queueing: duration, clips, texts, sound. Nothing is posted; the result lands in Ready to post. */
export function ExportDialog({ open, state, busy, error, onClose, onConfirm }: { open: boolean; state: EditorState; busy: boolean; error: string | null; onClose: () => void; onConfirm: () => void }) {
  const rows: Array<[string, string]> = [
    ["Length", fmtTime(totalDuration(state))],
    ["Clips", String(state.clips.length)],
    ["Text overlays", String(state.texts.filter((t) => t.text.trim()).length)],
    ["Sound", state.sound ? `${state.sound.name} at ${Math.round(state.sound.volume * 100)}%` : "None"],
    ["Original audio", `${Math.round(state.originalVolume * 100)}%`],
    ["Framing", state.fit === "fill" ? "Fill (crop)" : "Fit (blurred bars)"],
  ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export this video"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Keep editing</Button>
          <Button onClick={onConfirm} disabled={busy}>{busy ? "Queuing…" : "Render it"}</Button>
        </div>
      }
    >
      <dl className="flex flex-col divide-y divide-ds-line text-[15px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2">
            <dt className="text-ds-muted">{k}</dt>
            <dd className="ds-num min-w-0 truncate text-right text-ds-text">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[14px] text-ds-muted">The render takes a few minutes. It shows up in Ready to post for you to watch and approve. Nothing is posted by this.</p>
      {error ? <p role="alert" className="mt-3 text-[14px] text-ds-danger">{error}</p> : null}
    </Dialog>
  );
}
