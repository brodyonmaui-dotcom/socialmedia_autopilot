"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { EngagementPlatform, Mode } from "@autopilot/engagement";
import { setDmDraftsAction, setPauseAction, setReplyModeAction } from "../../app/settings/actions.js";
import { autoOk, MODE_LABEL, MODES, pauseCopy, resumeOk } from "../../lib/settings/replies.js";
import { Button, Dialog, Input, PLATFORM_NAME, PlatformLogo, SegmentBar, SegmentButton, Toggle } from "../ui/index.js";

function Submit({ label, disabled, form }: { label: string; disabled?: boolean; form: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" form={form} variant="solid" disabled={disabled || pending} aria-disabled={disabled || pending} className="sm:min-w-36">
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Points({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-snug text-ds-muted marker:text-ds-line-strong">
      {items.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

/**
 * "Pause all replies" (the engagement kill switch). Flipping it never changes anything by itself: it opens a
 * Dialog; pausing takes one confirm (reason optional), resuming needs "resume" typed (checked on the server too).
 */
export function PauseSwitch({ paused, reason, envPaused }: { paused: boolean; reason?: string | undefined; envPaused: boolean }) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const copy = pauseCopy(paused);
  const formId = useId();
  useEffect(() => setOpen(false), [paused]);

  return (
    <>
      <Toggle
        label="Pause all replies"
        description={
          envPaused
            ? "Paused on the server. The switch here can't override that."
            : paused
              ? `Paused: ${reason ?? "no reason given"}`
              : "Stops every auto reply and hide at once. Drafts keep coming."
        }
        checked={paused || envPaused}
        disabled={envPaused}
        onChange={() => {
          setWord("");
          setOpen(true);
        }}
      />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={copy.title}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Submit form={formId} label={copy.confirm} disabled={paused && !resumeOk(word)} />
          </>
        }
      >
        <form id={formId} action={setPauseAction.bind(null, !paused)} className="flex flex-col gap-5">
          <Points items={copy.points} />
          {paused ? (
            <Input name="confirm" label='Type "resume" to confirm' value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" autoCapitalize="none" maxLength={200} />
          ) : (
            <Input name="reason" label="Reason (optional)" placeholder="Odd replies, travelling…" maxLength={200} autoComplete="off" />
          )}
        </form>
      </Dialog>
    </>
  );
}

/**
 * One platform's reply mode: Off / Drafts only submit at once (no JS needed); Auto opens a Dialog that needs
 * "auto" typed. Next to Auto the row says it needs his OK in chat (CLAUDE.md: auto-reply changes need it).
 */
export function ModeRow({ platform, mode }: { platform: EngagementPlatform; mode: Mode }) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const formId = useId();
  const name = PLATFORM_NAME[platform];
  useEffect(() => setOpen(false), [mode]);

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-ds-sm bg-ds-raised text-ds-text">
          <PlatformLogo platform={platform} size={18} />
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold text-ds-text">{name}</span>
          <span className="block text-[13px] text-ds-muted">{mode === "live" ? "Auto is on" : "Auto needs your OK in chat"}</span>
        </span>
      </div>
      <form className="w-full sm:w-auto sm:min-w-[316px]">
        <SegmentBar ariaLabel={`${name} replies`}>
          {MODES.map((m) =>
            m === mode ? (
              <SegmentButton className="whitespace-nowrap px-2" key={m} active type="button">
                {MODE_LABEL[m]}
              </SegmentButton>
            ) : m === "live" ? (
              <SegmentButton
                className="whitespace-nowrap px-2"
                key={m}
                active={false}
                type="button"
                onClick={() => {
                  setWord("");
                  setOpen(true);
                }}
              >
                {MODE_LABEL[m]}
              </SegmentButton>
            ) : (
              <SegmentButton className="whitespace-nowrap px-2" key={m} active={false} formAction={setReplyModeAction.bind(null, platform, m)}>
                {MODE_LABEL[m]}
              </SegmentButton>
            ),
          )}
        </SegmentBar>
      </form>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Turn on auto replies for ${name}?`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Submit form={formId} label="Turn on Auto" disabled={!autoOk(word)} />
          </>
        }
      >
        <form id={formId} action={setReplyModeAction.bind(null, platform, "live")} className="flex flex-col gap-5">
          <Points
            items={[
              "This needs your OK in chat first: changing how replies go out is never done from a tap alone.",
              "Routine replies then go out on their own after the veto window. Questions and anything personal stay flagged for you.",
              "Nothing is sent until the server is also set to live. Replies drafted before the switch never go out.",
            ]}
          />
          <Input name="confirm" label='Type "auto" to confirm' value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" autoCapitalize="none" maxLength={20} />
        </form>
      </Dialog>
    </li>
  );
}

/** DM drafts switch: flipping it submits at once (a read-only poll that drafts; nothing is ever sent). */
export function DmDraftsSwitch({ on }: { on: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setBusy(false), [on]);
  return (
    <form ref={form} action={setDmDraftsAction}>
      <input type="hidden" name="on" value={on ? "off" : "on"} />
      <Toggle
        label="Draft replies to Instagram DMs"
        description="Reads DMs every 5 minutes and drafts replies you copy. Nothing is ever sent."
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
