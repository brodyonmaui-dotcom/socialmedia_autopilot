"use client";

import { useId } from "react";
import { useFormStatus } from "react-dom";
import { Button, Checkbox, PlatformLogo, Select, Sheet } from "../../../components/ui/index.js";

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

function Submit({ form, disabled }: { form: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  const off = pending || disabled;
  return (
    <Button type="submit" form={form} variant="solid" disabled={off} aria-disabled={off} className="sm:min-w-32">
      {pending ? "Adding…" : "Add as drafts"}
    </Button>
  );
}

/** Sheet: pick a library clip + platforms → addItemAction (drafts with no caption/time yet). */
export function AddClipSheet(props: { open: boolean; onClose: () => void; batchId: string; media: PickerMedia[]; action: (fd: FormData) => Promise<void> }) {
  const formId = useId();
  const empty = props.media.length === 0;
  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title="Add a clip"
      footer={
        <>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Submit form={formId} disabled={empty} />
        </>
      }
    >
      <form id={formId} action={props.action} className="flex flex-col gap-5">
        <input type="hidden" name="batchId" value={props.batchId} />
        {empty ? (
          <p>The library is empty: ingest clips first.</p>
        ) : (
          <Select label="Clip" name="mediaId" required defaultValue="">
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
          </Select>
        )}
        <fieldset className="border-t border-ds-line pt-4">
          <legend className="ds-caps float-left mb-1 w-full text-ds-text">Platforms</legend>
          <div className="clear-both">
            {PLATFORM_CHOICES.map(([value, label]) => (
              <Checkbox
                key={value}
                name="platforms"
                value={value}
                defaultChecked={value === "instagram"}
                label={
                  <span className="inline-flex items-center gap-2">
                    <PlatformLogo platform={value} size={16} />
                    {label}
                  </span>
                }
              />
            ))}
          </div>
        </fieldset>
      </form>
    </Sheet>
  );
}
