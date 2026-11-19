"use client";

// Fable to review: editor approval counts switch (UI half of the gate change; the server re-checks everything)
import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { setEditorApprovalAction } from "../../app/settings/actions.js";
import { EDITOR_APPROVAL_CONFIRM } from "../../lib/settings/view.js";
import { Button, Sheet, Toggle } from "../ui/index.js";

function TurnOn({ form }: { form: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" form={form} variant="solid" disabled={pending} aria-disabled={pending} className="sm:min-w-32">
      {pending ? "Working…" : "Turn on"}
    </Button>
  );
}

/**
 * "Editor approval counts", OFF by default. Turning it on opens a confirm sheet (nothing changes until "Turn on");
 * turning it off submits at once. While off, the calendar's one-tap "Approve & schedule" is the only way in.
 */
export function EditorApprovalSwitch({ on }: { on: boolean }) {
  const off = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  useEffect(() => {
    setBusy(false);
    setOpen(false);
  }, [on]);

  return (
    <>
      <form ref={off} action={setEditorApprovalAction}>
        <input type="hidden" name="on" value="off" />
        <Toggle
          label="Use my editor approval"
          description={
            on
              ? "On: renders you approve in your editing chats are scheduled with no second tap here, when they have zero warnings."
              : "Off: every post waits for your tap on Approve & schedule."
          }
          checked={on}
          disabled={busy}
          onChange={(next) => {
            if (next) {
              setOpen(true);
              return;
            }
            setBusy(true);
            off.current?.requestSubmit();
          }}
        />
      </form>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Turn on editor approval counts?"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <TurnOn form={formId} />
          </>
        }
      >
        <form id={formId} action={setEditorApprovalAction}>
          <input type="hidden" name="on" value="on" />
          <p>{EDITOR_APPROVAL_CONFIRM}</p>
        </form>
      </Sheet>
    </>
  );
}
