"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { REEL_LIMITS } from "@autopilot/media/src/reel-plan.js";
import { makeReelAction, type ReelFormState } from "../../app/library/reel-actions.js";
import { Button } from "../ui/Button.js";
import { InlineNotice } from "../ui/DataRow.js";
import { Input } from "../ui/Input.js";
import { Select } from "../ui/Select.js";
import { Textarea } from "../ui/Textarea.js";

export interface ReelFormProps {
  mediaId: string;
  durationS: number | null;
  hasAudio: boolean;
  sounds: ReadonlyArray<{ id: string; name: string }>;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="accent" disabled={pending}>
      {pending ? "Queueing…" : "Make the reel"}
    </Button>
  );
}

/**
 * "Make a reel" form: trim, sound (or keep the clip's own), how it's used, volumes, caption. The server
 * action re-checks everything (the worker's planReel rules + the calendar's caption lint); a refused submit
 * comes back with the reason and every field as typed. A made reel lands as a DRAFT in the calendar.
 */
export function ReelForm({ mediaId, durationS, hasAudio, sounds }: ReelFormProps) {
  const [state, action] = useActionState<ReelFormState, FormData>(makeReelAction, { error: null, values: {}, n: 0 });
  const v = state.values;
  const len = durationS != null ? Math.round(durationS * 10) / 10 : null;
  const vol = `${REEL_LIMITS.minVolume} to ${REEL_LIMITS.maxVolume}`;
  return (
    <form key={state.n} action={action} className="flex flex-col gap-4">
      {state.error ? (
        <InlineNotice tone="danger" live>
          {state.error}
        </InlineNotice>
      ) : null}
      <input type="hidden" name="mediaId" value={mediaId} />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Start at (seconds)" name="trimStartS" type="number" inputMode="decimal" min={0} step={0.1} placeholder="0" defaultValue={v.trimStartS ?? ""} />
        <Input
          label="End at (seconds)"
          name="trimEndS"
          type="number"
          inputMode="decimal"
          min={0}
          step={0.1}
          placeholder={len != null ? String(len) : "end"}
          defaultValue={v.trimEndS ?? ""}
        />
      </div>
      <p className="ds-helper -mt-2">
        A reel is {REEL_LIMITS.minDurationS} to {REEL_LIMITS.maxDurationS} seconds{len != null ? `; this clip is ${len} s` : ""}. Leave both blank to use the whole clip.
      </p>
      <Select label="Sound" name="soundId" defaultValue={v.soundId ?? (sounds[0]?.id ?? "original")} helper={sounds.length ? undefined : "No sounds yet: upload one on the Sounds page."}>
        {sounds.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
        {hasAudio ? <option value="original">Keep the clip&rsquo;s own sound</option> : null}
      </Select>
      <Select label="How the sound is used" name="audio" defaultValue={v.audio ?? "sound"} helper="Ignored when you keep the clip's own sound.">
        <option value="sound">Replace the clip&rsquo;s sound</option>
        {hasAudio ? <option value="mix">Mix with the clip&rsquo;s sound</option> : null}
      </Select>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Sound volume" name="soundVolume" type="number" inputMode="decimal" min={REEL_LIMITS.minVolume} max={REEL_LIMITS.maxVolume} step={0.1} placeholder="1 (0.5 in a mix)" defaultValue={v.soundVolume ?? ""} helper={vol} />
        <Input label="Clip volume" name="originalVolume" type="number" inputMode="decimal" min={REEL_LIMITS.minVolume} max={REEL_LIMITS.maxVolume} step={0.1} placeholder="1" defaultValue={v.originalVolume ?? ""} helper={vol} />
      </div>
      <Textarea label="Caption" name="caption" required rows={4} maxLength={2200} defaultValue={v.caption ?? ""} helper="Checked like the calendar: no places, at most 5 hashtags." />
      <div className="flex items-center gap-3">
        <Submit />
        <span className="ds-helper">The reel is saved as a draft post. Nothing is posted until you approve it.</span>
      </div>
    </form>
  );
}
