"use client";

import { useEffect, useId, useState } from "react";
import type { Platform } from "@autopilot/core";
import { igCheckAction, recordPublishedAction, resetCheckedAction } from "../../app/calendar/actions.js";
import { autoCheckText, canConfirmReset, keyTailLabel, type AutoCheckState, type AutoCheckView } from "../../lib/batches/card-view.js";
import { isResettablePlatform, RESET_CHECKLIST } from "../../lib/batches/reset.js";
import { Button, ButtonLink, Checkbox, Chip, Dialog, Input, PLATFORM_NAME, PlatformLogo } from "../ui/index.js";

type Mode = "reset" | "record";

export interface ResetDialogProps {
  batchId: string;
  itemId: string;
  platform: Platform;
  /** "Failed" / "Check it". */
  statusLabel: string;
  attempts: number;
  /** Sanitised at write time (F7 B1), straight from batch_items.last_error. */
  lastError: string | null;
  /** "Wed, Nov 18 · 09:00" in the creator's zone. */
  scheduled: string;
  keyTail: string | null;
  canReset: boolean;
  canRecord: boolean;
  /** Where the actions return to and where Close goes. */
  back: string;
  closeHref: string;
}

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
 * F11 on the calendar (`?reset=<itemId>`): "Not on the platform → back to Needs approval" or "It's there →
 * record it". Same rules as before: IG runs the read-only automatic check each time it opens (a hit hides
 * the reset and prefills the link); "Confirm reset" stays disabled until every box is ticked; the server
 * re-checks everything and the reset never approves.
 */
export function ResetDialog(p: ResetDialogProps) {
  const [mode, setMode] = useState<Mode>(p.canReset ? "reset" : "record");
  const [check, setCheck] = useState<AutoCheckState>(p.platform === "instagram" ? "checking" : "n/a");
  const [ticked, setTicked] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [postId, setPostId] = useState("");
  const [sent, setSent] = useState(false);
  const formId = useId();
  const isIg = p.platform === "instagram";
  const list = isResettablePlatform(p.platform) ? RESET_CHECKLIST[p.platform] : [];

  useEffect(() => {
    if (!isIg) return;
    let live = true;
    igCheckAction(p.batchId, p.itemId)
      .then((r) => {
        if (!live) return;
        setCheck(r.result);
        if (r.result === "found") {
          setMode("record");
          if (r.url) setUrl(r.url);
          if (r.platformPostId) setPostId(r.platformPostId);
        }
      })
      .catch(() => live && setCheck("error"));
    return () => {
      live = false;
    };
  }, [isIg, p.batchId, p.itemId]);

  const resetAllowed = p.canReset && check !== "found";
  const showReset = mode === "reset" && resetAllowed;
  const ready = canConfirmReset({ platform: p.platform, checked: ticked, check });
  const auto = autoCheckText(check);
  const name = PLATFORM_NAME[p.platform];
  const toggle = (s: string, on: boolean) => setTicked((prev) => (on ? [...prev.filter((x) => x !== s), s] : prev.filter((x) => x !== s)));
  const hidden = (
    <>
      <input type="hidden" name="back" value={p.back} />
      <input type="hidden" name="batchId" value={p.batchId} />
      <input type="hidden" name="itemId" value={p.itemId} />
    </>
  );

  return (
    <Dialog
      open
      closeHref={p.closeHref}
      title={showReset ? "Back to Needs approval?" : "Record as posted"}
      footer={
        <>
          <ButtonLink href={p.closeHref} variant="outline">
            Cancel
          </ButtonLink>
          {showReset ? (
            <Button type="submit" form={formId} variant="solid" disabled={!ready || sent}>
              {sent ? "Working…" : "Confirm reset"}
            </Button>
          ) : (
            <Button type="submit" form={formId} variant="solid" disabled={!p.canRecord || url.trim() === "" || sent}>
              {sent ? "Working…" : "Record it"}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-ds-sm bg-ds-raised p-3">
          <div className="flex items-center gap-2 text-ds-text">
            <PlatformLogo platform={p.platform} size={18} />
            <span className="text-[15px] font-semibold">{name}</span>
            <span className="ml-auto text-[13px] text-ds-muted">{keyTailLabel(p.keyTail)}</span>
          </div>
          <p className="ds-num text-[14px] text-ds-text">
            {p.statusLabel} · {p.attempts} attempt{p.attempts === 1 ? "" : "s"} · {p.scheduled}
          </p>
          <p className="whitespace-pre-wrap text-[14px] text-ds-muted [overflow-wrap:anywhere]">
            <span className="sr-only">Last error: </span>
            {p.lastError || "No error recorded."}
          </p>
        </div>

        {showReset ? (
          <form id={formId} action={resetCheckedAction} onSubmit={() => setSent(true)} className="flex flex-col gap-3">
            {hidden}
            <fieldset>
              <legend className="mb-1 text-[14px] font-semibold text-ds-text">I checked. Tick every box:</legend>
              {list.map((s) => (
                <Checkbox key={s} name="checked" value={s} label={s} checked={ticked.includes(s)} onChange={(e) => toggle(s, e.currentTarget.checked)} />
              ))}
            </fieldset>
            {isIg ? <AutoCheckChip view={auto} checking={check === "checking"} /> : null}
            <p className="ds-num text-[13px] text-ds-muted">
              {list.filter((s) => ticked.includes(s)).length} of {list.length} ticked. The reset never approves: it comes back as Needs approval.
            </p>
            {p.canRecord ? (
              <Button variant="ghost" size="sm" onClick={() => setMode("record")} className="self-start">
                It&apos;s there: record it instead
              </Button>
            ) : null}
          </form>
        ) : (
          <form id={formId} action={recordPublishedAction} onSubmit={() => setSent(true)} className="flex flex-col gap-4">
            {hidden}
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
              helper={`https only, on ${name}'s own site`}
            />
            <Input label="Post id (optional)" name="platformPostId" value={postId} onChange={(e) => setPostId(e.currentTarget.value)} autoComplete="off" />
            {resetAllowed ? (
              <Button variant="ghost" size="sm" onClick={() => setMode("reset")} className="self-start">
                Not there: back to Needs approval instead
              </Button>
            ) : null}
          </form>
        )}
      </div>
    </Dialog>
  );
}
