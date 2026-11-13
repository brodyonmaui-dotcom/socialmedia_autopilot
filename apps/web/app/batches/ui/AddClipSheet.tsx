"use client";

import { useFormStatus } from "react-dom";
import { BTN_GHOST, BTN_PRIMARY, INPUT } from "./WarningChip.js";

export interface PickerMedia {
  id: string;
  label: string;
  pillar: string | null;
  durationS: number | null;
  hasCleanFile: boolean;
}

const PLATFORM_CHOICES = [
  ["instagram", "Instagram"],
  ["youtube", "YouTube Shorts"],
  ["tiktok", "TikTok"],
  ["snapchat", "Snapchat (assisted)"],
] as const;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className={`${BTN_PRIMARY} flex-1`} disabled={pending}>
      {pending ? "Adding…" : "Add as drafts"}
    </button>
  );
}

/** Bottom sheet: pick a library clip + platforms → addItemAction (drafts with no caption/time yet). */
export function AddClipSheet(props: { open: boolean; onClose: () => void; batchId: string; media: PickerMedia[]; action: (fd: FormData) => Promise<void> }) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={props.onClose}>
      <form
        action={props.action}
        onClick={(e) => e.stopPropagation()}
        className="mx-auto max-h-[85vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 pb-8 dark:bg-neutral-900"
        role="dialog"
        aria-label="Add clip"
      >
        <h2 className="text-lg font-semibold">Add a clip</h2>
        <input type="hidden" name="batchId" value={props.batchId} />
        {props.media.length === 0 ? (
          <p className="text-base text-neutral-500">The library is empty: ingest clips first.</p>
        ) : (
          <label className="block text-sm text-neutral-500">
            Clip
            <select name="mediaId" required className={INPUT} defaultValue="">
              <option value="" disabled>
                pick a clip…
              </option>
              {props.media.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.pillar ? ` · ${m.pillar}` : ""}
                  {m.durationS != null ? ` · ${Math.round(m.durationS)} s` : ""}
                  {m.hasCleanFile ? "" : " · no clean file"}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="space-y-1">
          <legend className="text-sm text-neutral-500">Platforms</legend>
          {PLATFORM_CHOICES.map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-3 text-base">
              <input type="checkbox" name="platforms" value={value} defaultChecked={value === "instagram"} className="h-5 w-5" />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="flex gap-2">
          <Submit />
          <button type="button" className={BTN_GHOST} onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
