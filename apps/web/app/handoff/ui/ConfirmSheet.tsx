"use client";

import { BTN_GHOST } from "../../batches/ui/WarningChip.js";

/** Bottom-sheet confirm, same look as the batch screens' Approve-all sheet (ApproveBar). */
export function ConfirmSheet(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children?: React.ReactNode;
  confirmLabel: string;
  confirmClass: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={props.busy ? undefined : props.onClose}>
      <div
        role="dialog"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
        className="mx-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 pb-8 dark:bg-neutral-900"
      >
        <h2 className="text-lg font-semibold">{props.title}</h2>
        {props.children}
        <div className="mt-4 flex gap-2">
          <button type="button" className={`${props.confirmClass} flex-1`} disabled={props.busy} onClick={props.onConfirm}>
            {props.busy ? "Working…" : props.confirmLabel}
          </button>
          <button type="button" className={BTN_GHOST} disabled={props.busy} onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
