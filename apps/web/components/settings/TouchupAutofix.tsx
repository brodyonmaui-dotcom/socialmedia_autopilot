"use client";

import { useEffect, useRef, useState } from "react";
import { setTouchupAutofixAction } from "../../app/settings/actions.js";
import { Toggle } from "../ui/index.js";

/** "Fix touch-ups automatically", on by default. Submits at once either way: it never changes an original or a post. */
export function TouchupAutofixSwitch({ on }: { on: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const value = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setBusy(false), [on]);
  return (
    <form ref={form} action={setTouchupAutofixAction}>
      <input ref={value} type="hidden" name="on" value={on ? "off" : "on"} readOnly />
      <Toggle
        label="Fix touch-ups automatically"
        description={
          on
            ? "On: when a clip is checked and has something Fix it can change, the fix is made for you. Originals stay as they are; you still choose to keep each fix."
            : "Off: nothing is fixed until you tap Fix it."
        }
        checked={on}
        disabled={busy}
        onChange={() => {
          setBusy(true);
          form.current?.requestSubmit();
        }}
      />
    </form>
  );
}
