"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonVariant } from "./Button.js";
import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Native <dialog> opened with showModal() (browser handles focus trap, inert page, Esc).
 * Phone: bottom sheet with grab handle + safe-area padding. ≥640px: centered dialog.
 * Esc and backdrop click both call onClose.
 */
export function Sheet({ open, onClose, title, children, footer, className }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  function onBackdrop(e: MouseEvent<HTMLDialogElement>) {
    // Clicks on the inner panel target descendants; only the ::backdrop area targets the dialog itself.
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        if (open) onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={onBackdrop}
      className={cx(
        "fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-visible bg-transparent p-0 text-ds-text",
        "sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md",
        "backdrop:bg-ds-text/40 backdrop:backdrop-blur-sm",
        className,
      )}
    >
      <div
        className={cx(
          "ds-root flex max-h-[85dvh] flex-col border-t border-ds-text bg-ds-bg shadow-ds-pop",
          "px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:border sm:p-6",
        )}
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-0.5 w-8 shrink-0 bg-ds-line-strong sm:hidden" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id={titleId} className="pt-2 text-[28px] font-black leading-[1.05] tracking-[-0.03em]">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={cx(
              "-mr-2 inline-flex size-11 shrink-0 items-center justify-center text-ds-muted transition-colors duration-300 ease-ds hover:bg-ds-raised hover:text-ds-text",
              FOCUS,
            )}
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto text-[16px] leading-normal text-ds-muted">{children}</div>
        {footer && <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </dialog>
  );
}

export interface ConfirmSheetProps {
  triggerLabel: ReactNode;
  triggerVariant?: Exclude<ButtonVariant, "icon">;
  triggerTone?: "default" | "danger";
  triggerClassName?: string;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Client callback; the sheet closes after it resolves. */
  onConfirm?: () => void | Promise<void>;
  /** Server action; the confirm button submits a form carrying `fields` as hidden inputs. */
  formAction?: (formData: FormData) => void | Promise<void>;
  fields?: Record<string, string>;
  disabled?: boolean;
}

function ConfirmSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="solid" disabled={pending} aria-disabled={pending} className="sm:min-w-32">
      {pending ? "Working…" : label}
    </Button>
  );
}

/** Trigger button → Sheet with a solid (black) confirm and an outline cancel. */
export function ConfirmSheet({
  triggerLabel,
  triggerVariant = "outline",
  triggerTone,
  triggerClassName,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  formAction,
  fields,
  disabled,
}: ConfirmSheetProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(false);

  const cancel = (
    <Button variant="outline" onClick={close}>
      {cancelLabel}
    </Button>
  );

  let footer: ReactNode;
  if (formAction) {
    footer = (
      <form
        className="contents"
        action={async (fd) => {
          await formAction(fd);
          close();
        }}
      >
        {fields && Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {cancel}
        <ConfirmSubmit label={confirmLabel} />
      </form>
    );
  } else {
    footer = (
      <>
        {cancel}
        <Button
          variant="solid"
          disabled={busy}
          className="sm:min-w-32"
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm?.();
              close();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </>
    );
  }

  return (
    <>
      <Button
        variant={triggerVariant}
        tone={triggerTone}
        disabled={disabled}
        className={triggerClassName}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>
      <Sheet open={open} onClose={close} title={title} footer={footer}>
        {body}
      </Sheet>
    </>
  );
}
