"use client";
import Link from "next/link";
import { Select } from "../ui/index.js";
import type { StudioSound } from "../../lib/studio/types.js";
import type { Action, ESound } from "../../lib/studio/editor-state.js";
import { RangeField, SecField } from "./parts.js";

/** Sound under the original audio + the original's own volume. */
export function SoundPanel({ sounds, sound, originalVolume, dispatch }: { sounds: StudioSound[]; sound: ESound | null; originalVolume: number; dispatch: (a: Action) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <RangeField label="Original audio" value={originalVolume} min={0} max={1.5} step={0.05} onChange={(v) => dispatch({ type: "originalVolume", volume: v })} display={`${Math.round(originalVolume * 100)}%`} />
      <Select
        label="Sound"
        value={sound?.soundId ?? ""}
        onChange={(e) => {
          const s = sounds.find((x) => x.id === e.target.value);
          dispatch({ type: "setSound", sound: s ? { soundId: s.id, name: s.name, durationS: s.durationS } : null });
        }}
      >
        <option value="">No sound</option>
        {sounds.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      {sound ? (
        <>
          <RangeField label="Sound volume" value={sound.volume} min={0} max={1.5} step={0.05} onChange={(v) => dispatch({ type: "patchSound", patch: { volume: v } })} display={`${Math.round(sound.volume * 100)}%`} />
          <SecField label="Start the sound at (s)" value={sound.offsetS} max={sound.durationS ?? undefined} onChange={(v) => dispatch({ type: "patchSound", patch: { offsetS: v } })} />
        </>
      ) : null}
      <p className="text-[13px] text-ds-muted">
        Need another sound? <Link href="/library/sounds" className="font-semibold text-ds-accent-fg underline underline-offset-2">Upload one</Link>. The preview plays at most 100%; the export applies the full level.
      </p>
    </div>
  );
}
