"use client";
import { cx, FOCUS } from "../ui/index.js";
import { clipLen, fmtTime, totalDuration, type EditorState } from "../../lib/studio/editor-state.js";

/**
 * The timeline: a proportional bar of the clips (selected one filled), text windows and the sound under it, and
 * a playhead slider. The slider is the real control (keyboard + touch); the bar is a picture of the same thing.
 */
export function Timeline({ state, t, selected, onSelect, onScrub }: { state: EditorState; t: number; selected: string | null; onSelect: (uid: string) => void; onScrub: (t: number) => void }) {
  const total = totalDuration(state);
  const pct = (s: number) => (total > 0 ? Math.min(100, Math.max(0, (s / total) * 100)) : 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <div className="flex h-12 gap-px overflow-hidden rounded-ds-sm border border-ds-line bg-ds-line" role="group" aria-label="Clips on the timeline">
          {state.clips.length === 0 ? <div className="flex-1 bg-ds-card" /> : null}
          {state.clips.map((c, i) => (
            <button
              key={c.uid}
              type="button"
              onClick={() => onSelect(c.uid)}
              aria-pressed={selected === c.uid}
              aria-label={`Clip ${i + 1}, ${c.name}, ${clipLen(c).toFixed(1)} seconds`}
              style={{ flexGrow: clipLen(c), flexBasis: 0 }}
              className={cx("ds-num min-w-[20px] overflow-hidden text-ellipsis whitespace-nowrap px-1.5 text-left text-[11px] font-semibold", FOCUS, "focus-visible:-outline-offset-2", selected === c.uid ? "bg-ds-accent text-ds-ink" : "bg-ds-raised text-ds-muted hover:text-ds-text")}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div aria-hidden className="pointer-events-none absolute -top-1 bottom-[-4px] w-0.5 bg-ds-text" style={{ left: `${pct(t)}%` }} />
      </div>
      <div className="relative h-3" aria-hidden>
        {state.texts.map((x) => (
          <span key={x.uid} className="absolute top-0 h-1.5 bg-ds-text/70" style={{ left: `${pct(x.startS)}%`, width: `${Math.max(1, pct(Math.min(x.endS, total)) - pct(x.startS))}%` }} />
        ))}
        {state.sound ? <span className="absolute bottom-0 h-1.5 bg-ds-accent" style={{ left: 0, width: "100%" }} /> : null}
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor="studio-playhead" className="sr-only">Playhead</label>
        <input id="studio-playhead" type="range" min={0} max={Math.max(total, 0.1)} step={0.05} value={Math.min(t, total)} disabled={total === 0} onChange={(e) => onScrub(Number(e.target.value))} className={cx("h-11 min-w-0 flex-1 cursor-pointer accent-ds-accent", FOCUS)} />
        <span className="ds-num shrink-0 text-[13px] text-ds-muted">{fmtTime(t)} / {fmtTime(total)}</span>
      </div>
    </div>
  );
}
