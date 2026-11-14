"use client";

import { useEffect, useRef, useState } from "react";
import { Toggle } from "../../../components/ui/index.js";
import { setDmDraftsAction } from "../actions.js";

/**
 * F15: "Turn on DM drafts" switch. Flipping it submits setDmDraftsAction (server: dmPollVerified + an
 * acknowledged audit row). Read-only: the poll reads DMs and drafts replies; nothing is ever sent.
 */
export function DmDraftsSwitch({ on }: { on: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  // The action redirects back here; once the stored state arrives, the switch is usable again.
  useEffect(() => setBusy(false), [on]);
  return (
    <form ref={form} action={setDmDraftsAction}>
      {/* A flip always means "the opposite of the stored state"; the server sets exactly that value. */}
      <input type="hidden" name="on" value={on ? "off" : "on"} />
      <Toggle
        label="Turn on DM drafts (read-only, never sends)"
        description="Reads your Instagram DMs every 5 minutes and drafts replies you copy. Nothing is ever sent."
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
