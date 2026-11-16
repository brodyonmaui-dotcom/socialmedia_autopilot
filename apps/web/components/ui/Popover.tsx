"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { cx } from "./cx.js";
import { placePanel, type Placement } from "./popover-position.js";

export type PopoverTriggerProps = {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-haspopup": "dialog" | "menu";
};

const PHONE = "(max-width: 640px)";

/**
 * Click-to-open panel anchored to its trigger. Esc or a click outside closes it (Esc returns focus to the
 * trigger). The panel is `position: fixed`, so a card's `overflow-hidden` never clips it, and it flips
 * above the trigger at the bottom edge. `sheetOnPhone`: ≤ 640 px it becomes a full-width sheet under the
 * top bar instead. Hairline + pop shadow, 12 px radius, 150 ms fade.
 *
 * `trigger` is a render prop (client callers only); spread its props onto a <button> or <IconButton>.
 * `onOpen` runs after opening (e.g. Menu focuses its first item).
 */
export function Popover({
  trigger,
  children,
  label,
  role = "dialog",
  align = "start",
  width = 320,
  sheetOnPhone = false,
  open: openProp,
  onOpenChange,
  onOpen,
  panelClassName,
}: {
  trigger: (p: PopoverTriggerProps) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Accessible name of the panel. */
  label: string;
  role?: "dialog" | "menu";
  align?: "start" | "end";
  /** Panel width in px (desktop; clamped to the viewport). */
  width?: number;
  sheetOnPhone?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpen?: (panel: HTMLElement) => void;
  panelClassName?: string;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const [sheet, setSheet] = useState(false);

  const setOpen = useCallback(
    (v: boolean) => {
      if (openProp === undefined) setOpenState(v);
      onOpenChange?.(v);
    },
    [openProp, onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);

  const measure = useCallback(() => {
    const a = btn.current;
    const p = panel.current;
    if (!a || !p) return;
    const phone = sheetOnPhone && window.matchMedia(PHONE).matches;
    setSheet(phone);
    if (phone) return;
    const r = a.getBoundingClientRect();
    setPlace(
      placePanel(
        { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height },
        { width: Math.min(width, window.innerWidth - 16), height: p.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
        { align },
      ),
    );
  }, [align, width, sheetOnPhone]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const p = panel.current;
    if (p && onOpen) onOpen(p);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || btn.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        btn.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
    // onOpen is intentionally read once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close, measure]);

  const style = sheet
    ? undefined
    : place
      ? { top: place.top, left: place.left, width: Math.min(width, typeof window === "undefined" ? width : window.innerWidth - 16), maxHeight: place.maxHeight }
      : { top: 0, left: 0, width, visibility: "hidden" as const };

  return (
    <>
      {trigger({ ref: btn, onClick: () => setOpen(!open), "aria-expanded": open, "aria-controls": id, "aria-haspopup": role })}
      {open && (
        <div
          ref={panel}
          id={id}
          role={role === "dialog" ? "dialog" : undefined}
          aria-label={role === "dialog" ? label : undefined}
          style={style}
          className={cx(
            "ds-fade fixed z-[70] overflow-y-auto border border-ds-line bg-ds-card text-ds-text shadow-ds-pop",
            sheet ? "inset-x-2 top-[calc(var(--ds-topbar-h)+4px)] max-h-[calc(100dvh-var(--ds-topbar-h)-16px)] rounded-ds-lg" : "rounded-ds-lg",
            panelClassName,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </>
  );
}
