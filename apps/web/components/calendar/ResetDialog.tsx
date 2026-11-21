"use client";

import { useEffect, useId, useState } from "react";
import type { Platform } from "@autopilot/core";
import { igCheckAction, recordPublishedAction, resetCheckedAction } from "../../app/calendar/actions.js";
import { autoCheckText, canConfirmReset, keyTailLabel, recordConfirmText, verifyLabel, type AutoCheckState, type AutoCheckView } from "../../lib/batches/card-view.js";
import { isResettablePlatform, RESET_CHECKLIST } from "../../lib/batches/reset.js";
import { Button, ButtonLink, Checkbox, Chip, Dialog, Input, PLATFORM_NAME, PlatformLogo } from "../ui/index.js";

type Mode = "main" | "confirm";

export interface ResetDialogProps {
  batchId: string;
  itemId: string;
  platform: Platform;
  /** "Failed" / "Check it". */
  statusLabel: string;
  attempts: number;
  /** Sanitised at write time (F7 B1), straight from batch_items.last_error. */
  lastError: string | null;
  /** Post title (shown in the record confirm). */
  title: string;
  /** "Wed, Nov 18 · 9:00 AM" (12-hour) in the creator's zone. */
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
 * F11/F19 S6 on the calendar (`?reset=<itemId>`). Shows one of four states (Waiting to post / Posted
 * (confirmed) / Not found yet / Can't check automatically) and two real buttons: "Check again" (the
 * read-only IG check) and "It's published, record it" (a confirm, then recordPublishedAction, which never
 * calls an adapter). "Not posted, send it again" (reset to draft) is secondary, behind a disclosure, and
 * keeps its server-side checklist gate: every box ticked, and the IG check must not have found the post.
 */
export function ResetDialog(p: ResetDialogProps) {
  const [mode, setMode] = useState<Mode>("main");
  const [check, setCheck] = useState<AutoCheckState>(p.platform === "instagram" ? "checking" : "n/a");
  const [ticked, setTicked] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [postId, setPostId] = useState("");
  const [sent, setSent] = useState(false);
  const [runs, setRuns] = useState(0);
  const recordId = useId();
  const resetId = useId();
  const isIg = p.platform === "instagram";
  const list = isResettablePlatform(p.platform) ? RESET_CHECKLIST[p.platform] : [];

  useEffect(() => {
    if (!isIg) return;
    let live = true;
    setCheck("checking");
    igCheckAction(p.batchId, p.itemId)
      .then((r) => {
        if (!live) return;
        setCheck(r.result);
        if (r.result === "found") {
          if (r.url) setUrl(r.url);
          if (r.platformPostId) setPostId(r.platformPostId);
        }
      })
      .catch(() => live && setCheck("error"));
    return () => {
      live = false;
    };
  }, [isIg, p.batchId, p.itemId, runs]);

  const resetAllowed = p.canReset && check !== "found";
  const ready = canConfirmReset({ platform: p.platform, checked: ticked, check });
  const auto = autoCheckText(check);
  const label = verifyLabel("failed", check);
  const name = PLATFORM_NAME[p.platform];
  const toggle = (s: string, on: boolean) => setTicked((prev) => (on ? [...prev.filter((x) => x !== s), s] : prev.filter((x) => x !== s)));
  const hidden = (
    <>
      <input type="hidden" name="back" value={p.back} />
      <input type="hidden" name="batchId" value={p.batchId} />
      <input type="hidden" name="itemId" value={p.itemId} />
    </>
  );
  const confirming = mode === "confirm";

  return (
    <Dialog
      open
      closeHref={p.closeHref}
      title={confirming ? "Record as posted?" : "Is it published?"}
      footer={
        confirming ? (
          <>
            <Button variant="outline" onClick={() => setMode("main")} disabled={sent}>
              Back
            </Button>
            <Button type="submit" form={recordId} variant="solid" disabled={!p.canRecord || url.trim() === "" || sent}>
              {sent ? "Working…" : "Yes, record it"}
            </Button>
          </>
        ) : (
          <>
            <ButtonLink href={p.closeHref} variant="outline">
              Close
            </ButtonLink>
            {isIg ? (
              <Button variant="outline" onClick={() => setRuns((n) => n + 1)} disabled={check === "checking"}>
                {check === "checking" ? "Checking…" : "Check again"}
              </Button>
            ) : null}
            <Button variant="solid" onClick={() => setMode("confirm")} disabled={!p.canRecord}>
              It&apos;s published, record it
            </Button>
          </>
        )
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

        {confirming ? (
          <form id={recordId} action={recordPublishedAction} onSubmit={() => setSent(true)} className="flex flex-col gap-4">
            {hidden}
            <p className="text-[15px] text-ds-text">{recordConfirmText({ platform: name, title: p.title, scheduled: p.scheduled })}</p>
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
          </form>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-[15px] font-semibold text-ds-text">{label}</p>
              {isIg ? <AutoCheckChip view={auto} checking={check === "checking"} /> : null}
              <p className="text-[14px] text-ds-muted">Not seeing it? Check your profile or Reels tab.</p>
            </div>
            {resetAllowed ? (
              <details className="rounded-ds-sm border border-ds-line p-3">
                <summary className="cursor-pointer text-[14px] font-semibold text-ds-text">Not posted — send it again</summary>
                <form id={resetId} action={resetCheckedAction} onSubmit={() => setSent(true)} className="mt-3 flex flex-col gap-3">
                  {hidden}
                  <fieldset>
                    <legend className="mb-1 text-[14px] text-ds-muted">Only if you looked and it isn&apos;t there. Tick what you checked:</legend>
                    {list.map((s) => (
                      <Checkbox key={s} name="checked" value={s} label={s} checked={ticked.includes(s)} onChange={(e) => toggle(s, e.currentTarget.checked)} />
                    ))}
                  </fieldset>
                  <p className="ds-num text-[13px] text-ds-muted">
                    {list.filter((s) => ticked.includes(s)).length} of {list.length} ticked. It goes back to Needs approval; nothing sends until you approve it again.
                  </p>
                  <Button type="submit" variant="outline" disabled={!ready || sent} className="self-start">
                    {sent ? "Working…" : "Not posted — send it again"}
                  </Button>
                </form>
              </details>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
