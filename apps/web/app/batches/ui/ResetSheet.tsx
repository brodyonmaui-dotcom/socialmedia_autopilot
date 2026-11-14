"use client";

import { useEffect, useId, useState } from "react";
import type { Platform } from "@autopilot/core";
import { Button, Checkbox, Chip, Input, PLATFORM_NAME, PlatformLogo, Sheet } from "../../../components/ui/index.js";
import { autoCheckText, canConfirmReset, keyTailLabel, type AutoCheckState, type AutoCheckView } from "../../../lib/batches/card-view.js";
import { isResettablePlatform, RESET_CHECKLIST } from "../../../lib/batches/reset.js";
import type { ItemStatus } from "../../../lib/batches/types.js";
import { igCheckAction, recordPublishedAction, resetCheckedAction } from "../[id]/actions.js";

type Mode = "reset" | "record";

export interface ResetSheetProps {
  batchId: string;
  itemId: string;
  platform: Platform;
  status: ItemStatus;
  attempts: number;
  /** Sanitised at write time (F7 B1), straight from batch_items.last_error. Nothing else is shown. */
  lastError: string | null;
  /** "Mon 16 Nov · 09:00" in the creator's zone. */
  scheduled: string;
  keyTail: string | null;
  /** "Not on the platform → back to draft" applies (server canReset: failed|unknown, no post id, outbox platform). */
  canReset: boolean;
  /** "It's there → record it" applies (every failed/unknown item except Snapchat; never gated on canReset). */
  canRecord: boolean;
  /** Open on load (deep link `?reset=<itemId>`). */
  defaultOpen?: Mode | undefined;
}

function Submit({ label, disabled, form, sent }: { label: string; disabled: boolean; form: string; sent: boolean }) {
  const off = disabled || sent;
  return (
    <Button type="submit" form={form} variant="solid" disabled={off} aria-disabled={off} className="px-3 sm:min-w-40">
      {sent ? "Working…" : label}
    </Button>
  );
}

/** A two-line-safe label inside a Button (Button itself is nowrap). */
const Wrap = ({ children }: { children: string }) => <span className="whitespace-normal text-left">{children}</span>;

/** The IG automatic-check result as a Chip (warn carries the alert icon; n/a renders nothing). */
function AutoCheckChip({ view, checking }: { view: AutoCheckView | null; checking: boolean }) {
  if (!view) return null;
  return (
    <p role="status" className="flex">
      <Chip wrap tone={view.tone} icon={checking ? "clock" : view.tone === "accent" ? "check" : undefined}>
        {view.text}
      </Chip>
    </p>
  );
}

/**
 * F11: the two buttons on a failed/unknown card and the sheet behind them. IG runs the read-only
 * automatic check (igCheckAction) each time the sheet opens; a hit hides the reset and prefills
 * "record it". "Confirm reset" stays disabled until every checklist box is ticked (allTicked via
 * canConfirmReset). The server re-checks everything (the checklist strings and the IG lookup).
 */
export function ResetSheet(p: ResetSheetProps) {
  const initial: Mode = p.defaultOpen === "reset" && p.canReset ? "reset" : p.defaultOpen === "record" && p.canRecord ? "record" : p.canReset ? "reset" : "record";
  const [mode, setMode] = useState<Mode>(initial);
  const [open, setOpen] = useState(p.defaultOpen != null && (p.canReset || p.canRecord));
  const [check, setCheck] = useState<AutoCheckState>(p.platform === "instagram" ? "checking" : "n/a");
  const [ticked, setTicked] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [postId, setPostId] = useState("");
  const [sent, setSent] = useState(false);
  const formId = useId();
  const isIg = p.platform === "instagram";
  const list = isResettablePlatform(p.platform) ? RESET_CHECKLIST[p.platform] : [];

  useEffect(() => {
    if (!open || !isIg) return;
    let live = true;
    setCheck("checking");
    igCheckAction(p.batchId, p.itemId)
      .then((r) => {
        if (!live) return;
        setCheck(r.result);
        if (r.result === "found") {
          // F11 goal 3: a hit refuses the reset and offers "record it" with the found URL prefilled.
          setMode("record");
          if (r.url) setUrl(r.url);
          if (r.platformPostId) setPostId(r.platformPostId);
        }
      })
      .catch(() => live && setCheck("error"));
    return () => {
      live = false;
    };
  }, [open, isIg, p.batchId, p.itemId]);

  if (!p.canReset && !p.canRecord) return null;

  const show = (m: Mode) => {
    setMode(m);
    setOpen(true);
  };
  const close = () => setOpen(false);
  const resetAllowed = p.canReset && check !== "found";
  const showReset = mode === "reset" && resetAllowed;
  const ready = canConfirmReset({ platform: p.platform, checked: ticked, check });
  const auto = autoCheckText(check);
  const name = PLATFORM_NAME[p.platform];

  /** Same pattern as ConfirmSheet: the action redirects back with ?error/?note; close once it settles. */
  const submit = (action: (fd: FormData) => Promise<void>) => async (fd: FormData) => {
    setSent(true);
    try {
      await action(fd);
      close();
    } finally {
      setSent(false);
    }
  };
  const toggle = (s: string, on: boolean) => setTicked((prev) => (on ? [...prev.filter((x) => x !== s), s] : prev.filter((x) => x !== s)));

  return (
    <>
      <div className="flex flex-col gap-2">
        {p.canReset ? (
          <Button variant="outline" block onClick={() => show("reset")}>
            <Wrap>Not on the platform → back to draft</Wrap>
          </Button>
        ) : null}
        {p.canRecord ? (
          <Button variant="outline" block onClick={() => show("record")}>
            <Wrap>It&apos;s there → record it</Wrap>
          </Button>
        ) : null}
      </div>

      <Sheet
        open={open}
        onClose={close}
        title={showReset ? "Back to draft?" : "Record as published"}
        footer={
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            {showReset ? (
              <Submit form={formId} label="Confirm reset" disabled={!ready} sent={sent} />
            ) : (
              <Submit form={formId} label="Record it" disabled={!p.canRecord || url.trim() === ""} sent={sent} />
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 border-b border-ds-line pb-4">
            <div className="flex items-center gap-3 text-ds-text">
              <PlatformLogo platform={p.platform} size={20} />
              <span className="ds-caps">{name}</span>
              <span className="ds-mono ml-auto text-ds-muted">{keyTailLabel(p.keyTail)}</span>
            </div>
            <p className="ds-mono text-ds-text">
              {p.status} · {p.attempts} attempt{p.attempts === 1 ? "" : "s"} · {p.scheduled}
            </p>
            <p className="ds-mono whitespace-pre-wrap border-l-2 border-ds-danger pl-3 text-ds-text [overflow-wrap:anywhere]">
              <span className="sr-only">Last error: </span>
              {p.lastError || "no error recorded"}
            </p>
          </div>

          {showReset ? (
            <form id={formId} action={submit(resetCheckedAction)} className="flex flex-col gap-3">
              <input type="hidden" name="batchId" value={p.batchId} />
              <input type="hidden" name="itemId" value={p.itemId} />
              <fieldset>
                <legend className="ds-caps float-left mb-1 w-full text-ds-text">I checked · tick every box</legend>
                <div className="clear-both">
                  {list.map((s) => (
                    <Checkbox key={s} name="checked" value={s} label={s} checked={ticked.includes(s)} onChange={(e) => toggle(s, e.currentTarget.checked)} />
                  ))}
                </div>
              </fieldset>
              {isIg ? <AutoCheckChip view={auto} checking={check === "checking"} /> : null}
              <p className="ds-mono text-ds-muted">
                {list.filter((s) => ticked.includes(s)).length}/{list.length} ticked · the reset never approves: it comes back as a draft
              </p>
              {p.canRecord ? (
                <Button variant="ghost" onClick={() => setMode("record")} className="self-start">
                  <Wrap>It&apos;s there → record it instead</Wrap>
                </Button>
              ) : null}
            </form>
          ) : (
            <form id={formId} action={submit(recordPublishedAction)} className="flex flex-col gap-4">
              <input type="hidden" name="batchId" value={p.batchId} />
              <input type="hidden" name="itemId" value={p.itemId} />
              {isIg ? <AutoCheckChip view={auto} checking={check === "checking"} /> : null}
              <Input
                label={`${name} post link`}
                name="url"
                type="url"
                inputMode="url"
                required
                placeholder="https://"
                value={url}
                onChange={(e) => setUrl(e.currentTarget.value)}
                helper={`https only, on ${name}'s own domain`}
              />
              <Input label="Post id (optional)" name="platformPostId" value={postId} onChange={(e) => setPostId(e.currentTarget.value)} autoComplete="off" />
              {resetAllowed ? (
                <Button variant="ghost" onClick={() => setMode("reset")} className="self-start">
                  <Wrap>Not there → back to draft instead</Wrap>
                </Button>
              ) : null}
            </form>
          )}
        </div>
      </Sheet>
    </>
  );
}
