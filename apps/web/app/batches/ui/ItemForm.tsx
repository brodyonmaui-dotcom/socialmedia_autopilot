"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { BTN_GHOST, BTN_PRIMARY, INPUT } from "./WarningChip.js";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button className={BTN_PRIMARY} disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

/** Caption/title as text, with an Edit toggle that reveals the form (Save → editAction). */
export function ItemForm(props: {
  batchId: string;
  itemId: string;
  isYoutube: boolean;
  caption: string;
  title: string | null;
  scheduledLocal: string;
  editable: boolean;
  action: (fd: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="mt-2">
        {props.isYoutube ? <p className="text-base font-medium">{props.title || <span className="text-neutral-400">no title yet</span>}</p> : null}
        <p className="whitespace-pre-wrap text-base">{props.caption || <span className="text-neutral-400">no caption yet</span>}</p>
        {props.editable ? (
          <button type="button" className={`${BTN_GHOST} mt-2`} onClick={() => setOpen(true)}>
            Edit
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <form action={props.action} className="mt-2 space-y-2">
      <input type="hidden" name="batchId" value={props.batchId} />
      <input type="hidden" name="itemId" value={props.itemId} />
      {props.isYoutube ? (
        <label className="block text-sm text-neutral-500">
          Title
          <input name="title" defaultValue={props.title ?? ""} maxLength={100} className={INPUT} />
        </label>
      ) : null}
      <label className="block text-sm text-neutral-500">
        Caption
        <textarea name="caption" defaultValue={props.caption} rows={5} className={INPUT} />
      </label>
      <label className="block text-sm text-neutral-500">
        Time
        <input type="datetime-local" name="scheduledLocal" defaultValue={props.scheduledLocal} className={INPUT} />
      </label>
      <p className="text-sm text-neutral-500">Saving moves an approved post back to draft; approve it again after.</p>
      <div className="flex gap-2">
        <Save />
        <button type="button" className={BTN_GHOST} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
