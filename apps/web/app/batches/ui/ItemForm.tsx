"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, FIELD, FOCUS, Input, cx } from "../../../components/ui/index.js";

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="solid" disabled={pending} arrow>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

/**
 * The card's action row plus the Edit toggle. Not editing: [primary][Edit][danger] (the primary and
 * danger slots are server-rendered forms). Editing: the edit form (Save → editAction) replaces the row.
 * Form fields: batchId, itemId, title (YouTube only), caption, scheduledLocal.
 */
export function ItemForm(props: {
  batchId: string;
  itemId: string;
  isYoutube: boolean;
  caption: string;
  title: string | null;
  scheduledLocal: string;
  editable: boolean;
  action: (fd: FormData) => Promise<void>;
  primary?: ReactNode;
  danger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    if (!props.primary && !props.danger && !props.editable) return null;
    return (
      <div className="grid grid-cols-[1fr_auto_auto] gap-2">
        <div className="min-w-0">{props.primary}</div>
        {props.editable ? (
          <Button variant="outline" onClick={() => setOpen(true)} aria-label="Edit caption, title and time">
            Edit
          </Button>
        ) : (
          <span />
        )}
        {props.danger ?? <span />}
      </div>
    );
  }
  const captionId = `caption-${props.itemId}`;
  return (
    <form action={props.action} className="flex flex-col gap-4">
      <input type="hidden" name="batchId" value={props.batchId} />
      <input type="hidden" name="itemId" value={props.itemId} />
      {props.isYoutube ? <Input label="Title" name="title" defaultValue={props.title ?? ""} maxLength={100} /> : null}
      {/* No Textarea in the kit yet: the shared FIELD look; min-height beats FIELD's fixed h-12. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={captionId} className="ds-caps text-ds-muted">
          Caption
        </label>
        <textarea id={captionId} name="caption" defaultValue={props.caption} rows={6} className={cx(FIELD, FOCUS, "min-h-36 py-3 leading-normal")} />
      </div>
      <Input label="Time" type="datetime-local" name="scheduledLocal" defaultValue={props.scheduledLocal} helper="Saving moves an approved post back to draft; approve it again after." />
      <div className="grid grid-cols-2 gap-2">
        <Save />
        <Button variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
