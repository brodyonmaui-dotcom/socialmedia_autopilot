"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Badge, Button, Input, Sheet, Toggle } from "../../../components/ui/index.js";
import { killSheet, resumeOk } from "../../../lib/inbox/view.js";
import { setKillAction } from "../actions.js";

function Submit({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="solid" disabled={disabled || pending} aria-disabled={disabled || pending} className="sm:min-w-32">
      {pending ? "Working…" : label}
    </Button>
  );
}

/**
 * The engagement kill switch (toggle on = killed, as in the runbook). Flipping it never changes anything by
 * itself: it opens a Sheet that says what happens, and only the Sheet's form calls setKillAction.
 * Killing takes one confirm (reason optional); resuming needs "resume" typed (checked again on the server).
 */
export function KillSwitch({ killed, reason, tab }: { killed: boolean; reason?: string | undefined; tab: string }) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const copy = killSheet(killed);
  const close = () => setOpen(false);

  // The action redirects back here; once the stored state flips, the sheet has done its job.
  useEffect(() => setOpen(false), [killed]);

  return (
    <div className="flex flex-col gap-3">
      <Toggle
        label="Kill switch"
        description={killed ? "On · every auto action is stopped" : "Off · each platform follows its mode"}
        checked={killed}
        onChange={() => {
          setWord("");
          setOpen(true);
        }}
      />
      {killed ? (
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone="danger">Killed</Badge>
          <span className="ds-mono text-ds-muted">{reason ?? "no reason given"}</span>
        </p>
      ) : null}
      <Sheet open={open} onClose={close} title={copy.title}>
        <form
          action={async (fd) => {
            await setKillAction(!killed, fd);
            close();
          }}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="tab" value={tab} />
          <ul className="flex flex-col gap-2 border-y border-ds-line py-4">
            {copy.points.map((p) => (
              <li key={p} className="ds-note flex gap-3">
                <span aria-hidden="true" className="ds-mono pt-0.5 text-ds-accent-fg">
                  —
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
          {killed ? (
            <Input
              name="confirm"
              label='Type "resume" to confirm'
              value={word}
              onChange={(e) => setWord(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              maxLength={200}
            />
          ) : (
            <Input name="reason" label="Reason (optional)" placeholder="e.g. odd replies" maxLength={200} autoComplete="off" />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Submit label={copy.confirm} disabled={killed && !resumeOk(word)} />
          </div>
        </form>
      </Sheet>
    </div>
  );
}
