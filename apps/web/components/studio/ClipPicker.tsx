"use client";
import { useMemo, useState } from "react";
import { cx, FOCUS, Input, Select, Thumb } from "../ui/index.js";
import { fmtTime } from "../../lib/studio/editor-state.js";
import type { StudioClip } from "../../lib/studio/types.js";

/** Library clips by folder + search; tap one to append it to the timeline. */
export function ClipPicker({ clips, used, full, onAdd }: { clips: StudioClip[]; used: Map<string, number>; full: boolean; onAdd: (c: StudioClip) => void }) {
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const folders = useMemo(() => [...new Set(clips.map((c) => c.folder).filter((f): f is string => !!f))].sort(), [clips]);
  const shown = clips.filter((c) => (!folder || c.folder === folder) && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name" />
        <Select label="Folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
          <option value="">All</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </Select>
      </div>
      {full ? <p className="text-[13px] text-ds-muted">10 clips is the limit. Remove one to add another.</p> : null}
      {shown.length === 0 ? <p className="py-4 text-[14px] text-ds-muted">No clips match.</p> : null}
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((c) => (
          <li key={c.mediaId}>
            <button type="button" disabled={full} onClick={() => onAdd(c)} aria-label={`Add ${c.name}, ${fmtTime(c.durationS)}${used.get(c.mediaId) ? `, used ${used.get(c.mediaId)} times` : ""}`} className={cx("flex w-full flex-col gap-1 rounded-ds-sm border border-ds-line bg-ds-card p-1 text-left hover:bg-ds-raised disabled:opacity-50", FOCUS)}>
              <Thumb mediaId={c.mediaId} alt="" className="w-full" duration={fmtTime(c.durationS).replace(/\.\d$/, "")} />
              <span className="truncate text-[12px] font-semibold text-ds-text">{c.name}</span>
              {used.get(c.mediaId) ? <span className="ds-num text-[11px] text-ds-accent-fg">In project x{used.get(c.mediaId)}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
