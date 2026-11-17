"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dropAction, markPostedAction, skipAction } from "../../app/handoff/actions.js";
import { buttonFor, initialState, mediaPath, prepare, share, type ShareState } from "../../lib/handoff/share-machine.js";
import type { ActionResult, HandoffItem } from "../../lib/handoff/types.js";
import { durationLabel, orderedChecklist, resultText, shareHint, shareLabel } from "../../lib/handoff/view.js";
import { Badge, Button, ConfirmSheet, CopyButton, Icon, Input, posterSrc, Thumb, cx } from "../ui/index.js";

/**
 * One due Snapchat item (moved from /handoff): the plain rounded preview from the same-origin media route
 * (muted, inline, controls, never autoplay), the caption with Copy, the privacy checklist (location first),
 * "Share to Snapchat" (two taps: get the clip, then the share sheet), and Mark posted / Skip today / Drop
 * behind their confirmations. Rendered inside a Card by the page; a missed item's share button is outline so the
 * page keeps one solid button.
 */
export function SnapchatShare({ item, when, missed = false }: { item: HandoffItem; when: string; missed?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<ShareState>(() => initialState(item.blocks));
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const checklist = orderedChecklist(item.checklist);
  const length = durationLabel(item.durationS);
  const b = item.blocks.length > 0 ? buttonFor({ kind: "blocked" }) : buttonFor(state);
  const hint = item.blocks.length > 0 ? null : shareHint(state.kind === "ready" ? { kind: "ready", sizeMb: state.sizeMb } : state);

  async function onShare() {
    if (b.action === "prepare") {
      setState({ kind: "preparing" });
      setState(await prepare((u, i) => fetch(u, i), item.id, item.blocks));
    } else if (b.action === "share" && "file" in state && state.file && state.sizeMb) {
      // No await before share(): it must run inside this tap's user gesture (iOS).
      const { file, sizeMb } = state;
      const pending = share(typeof navigator === "undefined" ? undefined : navigator, file, sizeMb, item.caption);
      setState({ kind: "sharing", file, sizeMb });
      setState(await pending);
    }
  }

  async function run(verb: string, fn: () => Promise<ActionResult>) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: r.ok, text: resultText(r, verb) });
      if (r.ok) {
        setUrl("");
        router.refresh();
      }
    } catch {
      setMsg({ ok: false, text: "Something went wrong: reload." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[200px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-5">
      <div className="mx-auto w-full max-w-[220px] sm:mx-0 sm:max-w-none">
        {item.hasCleanFile ? (
          <video
            src={mediaPath(item.id)}
            poster={posterSrc(item.mediaId)}
            controls
            muted
            playsInline
            preload="none"
            aria-label={`${item.label}: preview`}
            className="block aspect-[9/16] w-full rounded-ds-sm bg-ds-raised object-cover"
          />
        ) : (
          <Thumb mediaId={item.mediaId} alt={`${item.label} poster`} duration={length} className="w-full" />
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ds-muted">
          <span className="ds-num">{when}</span>
          {length ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="ds-num">{length}</span>
            </>
          ) : null}
          {missed ? <Badge tone="warn">Missed</Badge> : null}
        </div>

        <div className="flex flex-col gap-2">
          <p className="ds-label text-ds-muted">Caption</p>
          <div className="flex items-start gap-2 rounded-ds-sm bg-ds-raised p-3">
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[15px] leading-snug text-ds-text">{item.caption || <span className="text-ds-muted">No caption</span>}</p>
            {item.caption ? <CopyButton text={item.caption} label="Copy" /> : null}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="ds-label text-ds-muted">Before you post</p>
          <ul className="flex flex-col divide-y divide-ds-line rounded-ds-sm border border-ds-line">
            {checklist.map((line, i) => (
              <li key={i} className="flex min-h-11 items-start gap-3 px-3 py-2.5">
                {line.privacy ? (
                  <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-ds-warn" />
                ) : (
                  <Icon name="check" size={18} className="mt-0.5 shrink-0 text-ds-muted" />
                )}
                <span className={cx("min-w-0 flex-1 text-[14px] leading-snug", line.privacy ? "font-semibold text-ds-text" : "text-ds-muted")}>{line.text}</span>
                {line.privacy ? <Badge tone="warn">Every time</Badge> : null}
              </li>
            ))}
          </ul>
        </div>

        {item.blocks.length > 0 ? (
          <div role="note" className="flex items-start gap-2 rounded-ds-sm border border-ds-line px-3 py-2.5 text-[14px] leading-snug text-ds-text">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-ds-danger" />
            <span>
              <span className="font-semibold">Share blocked: </span>
              {item.blocks.join(" ")}
            </span>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button variant={missed ? "outline" : "solid"} block disabled={b.disabled} aria-disabled={b.disabled} onClick={onShare}>
            {b.action === "share" ? <Icon name="share" size={18} /> : null}
            {shareLabel(b.label)}
          </Button>
          <p aria-live="polite" className="min-h-[18px] text-[13px] leading-snug text-ds-muted">
            {hint}
          </p>
          {state.kind === "error" ? (
            <p role="alert" className="flex items-start gap-2 text-[14px] leading-snug text-ds-danger">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
              {state.message}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <ConfirmSheet
              triggerLabel="Mark posted"
              triggerVariant="outline"
              triggerClassName="w-full"
              disabled={busy}
              title="Mark as posted on Spotlight?"
              confirmLabel="Yes, it's posted"
              onConfirm={() => run("Marked posted", () => markPostedAction(item.id, url.trim() || null))}
              body={
                <div className="flex flex-col gap-4">
                  <p>Only once it&apos;s live on Spotlight. This can&apos;t be undone here.</p>
                  <Input
                    label="Spotlight link (optional)"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    placeholder="https://…snapchat.com/…"
                    helper="Only snapchat.com links are kept."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
              }
            />
            <ConfirmSheet
              triggerLabel="Skip today"
              triggerVariant="outline"
              triggerClassName="w-full"
              disabled={busy}
              title="Skip to the next free day?"
              confirmLabel="Skip today"
              onConfirm={() => run("Skipped", () => skipAction(item.id))}
              body={<p>It moves to the next day with no other Snapchat post, same time. It stays approved.</p>}
            />
          </div>
          <div className="flex justify-end">
            <ConfirmSheet
              triggerLabel="Drop this post"
              triggerVariant="ghost"
              triggerTone="danger"
              disabled={busy}
              title="Drop this Snapchat post?"
              confirmLabel="Drop it"
              onConfirm={() => run("Dropped", () => dropAction(item.id))}
              body={<p>It&apos;s rejected and won&apos;t come back. Skip today moves it to the next free day instead.</p>}
            />
          </div>
        </div>

        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={cx("flex items-start gap-2 text-[15px] leading-snug", msg.ok ? "text-ds-accent-fg" : "text-ds-danger")}>
            <Icon name={msg.ok ? "check" : "alert"} size={16} className="mt-0.5 shrink-0" />
            {msg.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
