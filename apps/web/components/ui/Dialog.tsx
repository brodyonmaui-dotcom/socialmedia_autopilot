"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";

/**
 * Modal dialog on the native <dialog> (showModal: the browser traps focus, makes the page inert and
 * restores focus on close). Centred on desktop, a bottom sheet at ≤ 640 px. `placement="top"` anchors it
 * near the top (CommandPalette). Esc, the backdrop and the close button all close it.
 *
 * URL-driven use (server data, e.g. `?day=2026-11-18`): render it with `open` and `closeHref`; closing
 * replaces the URL with `closeHref` (no scroll jump). Client use: `open` + `onClose`.
 */
export function Dialog({
  open,
  onClose,
  closeHref,
  title,
  hideTitle = false,
  children,
  footer,
  size = "md",
  placement = "center",
  initialFocus,
  className,
}: {
  open: boolean;
  onClose?: () => void;
  closeHref?: string;
  title: string;
  /** Keep the title for screen readers only (CommandPalette). */
  hideTitle?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  /** md = 480 px, lg = 640 px, xl = 800 px. */
  size?: "md" | "lg" | "xl";
  placement?: "center" | "top";
  /** CSS selector inside the dialog to focus on open (default: the first focusable). */
  initialFocus?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();

  const close = () => {
    if (onClose) onClose();
    else if (closeHref) router.replace(closeHref, { scroll: false });
  };

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      if (initialFocus) d.querySelector<HTMLElement>(initialFocus)?.focus();
    }
    if (!open && d.open) d.close();
  }, [open, initialFocus]);

  function onBackdrop(e: MouseEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget) close();
  }

  const width = size === "xl" ? "sm:max-w-[800px]" : size === "lg" ? "sm:max-w-[640px]" : "sm:max-w-[480px]";
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={onBackdrop}
      className={cx(
        "fixed m-0 max-w-none overflow-visible bg-transparent p-0 text-ds-text backdrop:bg-ds-scrim",
        // Phones: a bottom sheet, except top-anchored dialogs (search) which sit under the status bar so the keyboard never covers them.
        placement === "top"
          ? "inset-x-2 bottom-auto top-2 w-[calc(100%-16px)] sm:inset-x-0 sm:top-[12vh] sm:mx-auto sm:w-[calc(100%-32px)]"
          : "inset-x-0 bottom-0 top-auto w-full sm:inset-0 sm:m-auto sm:h-fit sm:w-[calc(100%-32px)]",
        width,
        className,
      )}
    >
      <div
        className={cx(
          "ds-root ds-fade flex flex-col border border-ds-line bg-ds-card shadow-ds-pop sm:max-h-[76vh] sm:rounded-ds-lg",
          placement === "top" ? "max-h-[70dvh] rounded-ds-lg" : "max-h-[88dvh] rounded-t-ds-lg",
        )}
      >
        <div className={cx("flex items-start justify-between gap-3 px-4 pt-4 lg:px-5 lg:pt-5", hideTitle && "sr-only")}>
          <h2 id={titleId} className="ds-heading min-w-0 pt-2">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className={cx("-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-ds-sm text-ds-muted hover:bg-ds-raised hover:text-ds-text", FOCUS)}
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3 lg:px-5 lg:pb-5">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-ds-line px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:justify-end sm:pb-4 lg:px-5">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
}
