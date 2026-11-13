"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { AddClipSheet, type PickerMedia } from "./AddClipSheet.js";
import { BTN_GHOST, BTN_PRIMARY } from "./WarningChip.js";

function Pending({ children, className }: { children: React.ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending}>
      {pending ? "Working…" : children}
    </button>
  );
}

/** Sticky bottom bar. Counts come from the server-side approve-all plan, never from client state. */
export function ApproveBar(props: {
  batchId: string;
  approvable: number;
  warnCount: number;
  skipped: Array<{ itemId: string; label: string; reasons: string[] }>;
  untimedCount: number;
  media: PickerMedia[];
  approveAll: () => Promise<void>;
  fillTimes: () => Promise<void>;
  addItem: (fd: FormData) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-neutral-800 dark:bg-neutral-950/95">
        <div className="mx-auto flex max-w-2xl gap-2">
          <button type="button" className={`${BTN_PRIMARY} flex-1`} onClick={() => setConfirm(true)}>
            Approve all
          </button>
          <form action={props.fillTimes}>
            <Pending className={BTN_GHOST}>Fill times{props.untimedCount ? ` (${props.untimedCount})` : ""}</Pending>
          </form>
          <button type="button" className={BTN_GHOST} onClick={() => setAdding(true)}>
            Add clip
          </button>
        </div>
      </div>

      {confirm ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setConfirm(false)}>
          <div
            role="dialog"
            aria-label="Confirm approve all"
            onClick={(e) => e.stopPropagation()}
            className="mx-auto max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-4 pb-8 dark:bg-neutral-900"
          >
            <h2 className="text-lg font-semibold">
              Approve {props.approvable} · {props.skipped.length} blocked · {props.warnCount} warning{props.warnCount === 1 ? "" : "s"}
            </h2>
            <p className="mt-1 text-base text-neutral-600 dark:text-neutral-300">
              {props.approvable === 0
                ? "Nothing can be approved yet: fix the blocked posts first."
                : "Approved posts go out at their times. Blocked ones stay as drafts."}
            </p>
            {props.skipped.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {props.skipped.map((s) => (
                  <li key={s.itemId} className="rounded-lg border border-red-200 p-2 text-sm dark:border-red-900">
                    <div className="font-medium">{s.label}</div>
                    <ul className="list-disc pl-5 text-red-800 dark:text-red-200">
                      {s.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4 flex gap-2">
              <form action={props.approveAll} className="flex-1">
                <Pending className={`${BTN_PRIMARY} w-full`}>Confirm: approve {props.approvable}</Pending>
              </form>
              <button type="button" className={BTN_GHOST} onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AddClipSheet open={adding} onClose={() => setAdding(false)} batchId={props.batchId} media={props.media} action={props.addItem} />
    </>
  );
}
