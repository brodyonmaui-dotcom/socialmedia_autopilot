"use client";

import { useState } from "react";
import type { Platform } from "@autopilot/core";
import { Button, FIELD, FOCUS, Input, PLATFORM_NAME, Sheet, cx } from "../ui/index.js";

/**
 * "Edit caption" for one render: a Sheet with one caption field per platform (plus the YouTube title).
 * Submits editCaptionAction (the existing edit transition, server-side).
 */
export function EditCaptionSheet({
  batchId,
  from,
  label,
  edits,
  action,
}: {
  batchId: string;
  from: "home" | "batch";
  label: string;
  edits: Array<{ itemId: string; platform: Platform; caption: string; title: string | null }>;
  action: (fd: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const formId = `edit-${batchId}-${edits[0]?.itemId ?? "x"}`;
  return (
    <>
      <Button variant="outline" block onClick={() => setOpen(true)} aria-label={`Edit caption for ${label}`}>
        Edit caption
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Edit caption"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="solid" className="sm:min-w-32">
              Save
            </Button>
          </>
        }
      >
        <form id={formId} action={action} className="flex flex-col gap-6">
          <input type="hidden" name="batchId" value={batchId} />
          <input type="hidden" name="from" value={from} />
          {edits.map((e) => {
            const id = `cap-${e.itemId}`;
            return (
              <fieldset key={e.itemId} className="flex flex-col gap-3">
                <input type="hidden" name="itemId" value={e.itemId} />
                {e.platform === "youtube" ? <Input label="YouTube title" name={`title:${e.itemId}`} defaultValue={e.title ?? ""} maxLength={100} /> : null}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={id} className="ds-caps text-ds-muted">
                    {PLATFORM_NAME[e.platform]} caption
                  </label>
                  <textarea id={id} name={`caption:${e.itemId}`} defaultValue={e.caption} rows={4} className={cx(FIELD, FOCUS, "min-h-28 py-3 leading-normal")} />
                </div>
              </fieldset>
            );
          })}
          <p className="ds-note">Saving keeps the drafts as drafts. Approve after.</p>
        </form>
      </Sheet>
    </>
  );
}
