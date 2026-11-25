"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { addToCalendarForm, moveFolderForm } from "../../app/library/form-actions.js";
import { previewAddToCalendarAction } from "../../app/library/actions.js";
import type { AddPlan } from "../../lib/library/add-to-calendar.js";
import { PLATFORM_NAME } from "../../lib/platforms/view.js";
import { Button, Checkbox, cx, Dialog, Input, InlineNotice, Select } from "../ui/index.js";

const PLATFORMS = ["instagram", "youtube", "tiktok"] as const;
const SKIP_TEXT = { duplicate: "already planned or posted there within a week", "no-slot": "no open slot in the next 7 days", unavailable: "not available (no clean file, or hidden)" } as const;

const pickBoxes = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="pick"]'));

/**
 * Select mode: wraps the grid. The cards hold plain checkboxes (`name="pick"`); this reads them on every change, shows the
 * sticky bottom bar ("N selected", Move to folder…, Add to calendar…) and owns both dialogs. Nothing is sent until a
 * dialog's own form is submitted; Add to calendar only ever creates drafts.
 */
export function SelectShell({ children, folders, canMove, back, doneHref }: { children: ReactNode; folders: string[]; canMove: boolean; back: string; doneHref: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | "move" | "add">(null);

  const recount = useCallback(() => setIds(root.current ? pickBoxes(root.current).filter((b) => b.checked).map((b) => b.value) : []), []);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.addEventListener("change", recount);
    return () => el.removeEventListener("change", recount);
  }, [recount]);

  return (
    <div ref={root} className="pb-24">
      {children}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ds-line bg-ds-card pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-ds-pop">
        <div className="mx-auto flex w-full max-w-[var(--ds-max)] flex-wrap items-center gap-2 px-[var(--ds-gutter)]">
          <p role="status" aria-live="polite" className="ds-num mr-auto min-w-0 text-[15px] font-semibold text-ds-text">
            {ids.length} selected
          </p>
          {canMove ? (
            <Button variant="outline" size="sm" disabled={ids.length === 0} onClick={() => setDialog("move")}>
              Move to folder…
            </Button>
          ) : null}
          <Button size="sm" disabled={ids.length === 0} onClick={() => setDialog("add")}>
            Add to calendar…
          </Button>
          <a href={doneHref} className="inline-flex min-h-11 items-center px-2 text-[15px] font-semibold text-ds-muted hover:text-ds-text">
            Done
          </a>
        </div>
      </div>
      {canMove ? <MoveDialog open={dialog === "move"} onClose={() => setDialog(null)} ids={ids} folders={folders} back={back} /> : null}
      <AddDialog open={dialog === "add"} onClose={() => setDialog(null)} ids={ids} back={back} />
    </div>
  );
}

/** "Select all in this section": ticks every card in the section (or clears them when all are ticked). */
export function SelectSectionButton({ label = "Select all in this section", className }: { label?: string; className?: string }) {
  return (
    <button
      type="button"
      className={cx("inline-flex min-h-11 items-center rounded-ds-sm px-1 text-[14px] font-semibold text-ds-accent-fg hover:bg-ds-raised", className)}
      onClick={(e) => {
        const scope = e.currentTarget.closest("[data-select-scope]") ?? document;
        const boxes = pickBoxes(scope);
        const all = boxes.length > 0 && boxes.every((b) => b.checked);
        for (const b of boxes) b.checked = !all;
        boxes[0]?.dispatchEvent(new Event("change", { bubbles: true }));
      }}
    >
      {label}
    </button>
  );
}

function MoveDialog({ open, onClose, ids, folders, back }: { open: boolean; onClose: () => void; ids: string[]; folders: string[]; back: string }) {
  return (
    <Dialog open={open} onClose={onClose} title={`Move ${ids.length === 1 ? "1 clip" : `${ids.length} clips`} to a folder`}>
      <form action={moveFolderForm} className="flex flex-col gap-3">
        <input type="hidden" name="back" value={back} />
        {ids.map((id) => (
          <input key={id} type="hidden" name="mediaId" value={id} />
        ))}
        <Select label="Existing folder" name="existing" defaultValue="">
          <option value="">No folder (group by week)</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
        <Input label="Or a new folder" name="folder" maxLength={60} autoComplete="off" placeholder="e.g. Upper body" helper="A typed name wins. Up to 60 characters, no slashes." />
        <Button type="submit" className="self-start">
          Move
        </Button>
      </form>
    </Dialog>
  );
}

function AddDialog({ open, onClose, ids, back }: { open: boolean; onClose: () => void; ids: string[]; back: string }) {
  const [platforms, setPlatforms] = useState<string[]>([...PLATFORMS]);
  const [plan, setPlan] = useState<AddPlan | null>(null);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const key = `${ids.join(",")}|${platforms.join(",")}`;
  const last = useRef("");

  useEffect(() => {
    if (!open || last.current === key) return;
    last.current = key;
    if (ids.length === 0 || platforms.length === 0) {
      setPlan({ lines: [], skipped: [] });
      return;
    }
    start(async () => {
      const r = await previewAddToCalendarAction(ids, platforms);
      setError(!r.ok);
      setPlan(r.ok ? r.plan : null);
    });
  }, [open, key, ids, platforms]);
  useEffect(() => {
    if (!open) last.current = "";
  }, [open]);

  const toggle = (p: string) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : PLATFORMS.filter((x) => x === p || cur.includes(x))));
  const clips = plan ? [...new Set(plan.lines.map((l) => l.mediaId))] : [];
  const n = plan?.lines.length ?? 0;

  return (
    <Dialog open={open} onClose={onClose} title={`Add ${ids.length === 1 ? "1 clip" : `${ids.length} clips`} to the calendar`} size="lg">
      <form action={addToCalendarForm} className="flex flex-col gap-4">
        <input type="hidden" name="back" value={back} />
        {ids.map((id) => (
          <input key={id} type="hidden" name="mediaId" value={id} />
        ))}
        <fieldset className="flex flex-col">
          <legend className="ds-label mb-1 text-ds-muted">Platforms</legend>
          {PLATFORMS.map((p) => (
            <Checkbox key={p} name="platform" value={p} label={PLATFORM_NAME[p]} checked={platforms.includes(p)} onChange={() => toggle(p)} />
          ))}
        </fieldset>
        <p className="ds-helper">Each clip gets the next open time on each platform. Everything is added as a draft: nothing posts until you approve it in the calendar.</p>
        <div aria-live="polite" className="flex flex-col gap-3">
          {error ? <InlineNotice tone="danger">Couldn&rsquo;t work out the times. Try again.</InlineNotice> : null}
          {pending && !plan ? <p className="ds-helper">Finding open times…</p> : null}
          {plan && plan.lines.length > 0 ? (
            <ul aria-label="Planned times" className={cx("flex flex-col divide-y divide-ds-line border-y border-ds-line", pending && "opacity-60")}>
              {clips.map((id) => {
                const mine = plan.lines.filter((l) => l.mediaId === id);
                return (
                  <li key={id} className="flex min-w-0 flex-col gap-0.5 py-2">
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold text-ds-text">{mine[0]!.label}</span>
                    {mine.map((l) => (
                      <span key={l.platform} className="ds-num text-[13px] text-ds-muted">
                        {PLATFORM_NAME[l.platform]} · {l.when}
                      </span>
                    ))}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {plan && plan.lines.length === 0 && !pending && ids.length > 0 && platforms.length > 0 ? <p className="text-[14px] text-ds-text">Nothing can be added right now.</p> : null}
          {plan && plan.skipped.length > 0 ? (
            <div>
              <p className="ds-label mb-1 text-ds-muted">Skipped</p>
              <ul className="flex flex-col gap-0.5">
                {plan.skipped.map((s, i) => (
                  <li key={`${s.mediaId}-${s.platform}-${i}`} className="text-[13px] text-ds-muted">
                    {s.label}
                    {s.platform ? ` · ${PLATFORM_NAME[s.platform]}` : ""}: {SKIP_TEXT[s.reason]}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <Button type="submit" disabled={pending || n === 0} className="self-start">
          {n > 0 ? `Add ${n === 1 ? "1 draft" : `${n} drafts`}` : "Add drafts"}
        </Button>
      </form>
    </Dialog>
  );
}
