"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";

/**
 * Header disclosure menu (≡ button, 44px square like ThemeToggle). The panel drops under the sticky header:
 * full width on phones, a 360px column on the right gutter at ≥1024px. Opaque ds-bg, 1px lines, no shadow.
 * Closes on Esc (focus back to the button), outside click and route change. `children` may hold server-action forms.
 * `badge` shows a count dot on the button (e.g. open alerts) so it is visible before opening.
 */
export function HeaderMenu({
  label = "Menu",
  badge,
  children,
}: {
  label?: string;
  badge?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const shown = badge != null && badge > 0;
  return (
    <div ref={wrap} className="inline-flex">
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "relative inline-flex size-11 items-center justify-center border text-ds-text transition-colors duration-[var(--ds-dur)] ease-ds",
          open ? "border-ds-text bg-ds-raised" : "border-ds-line hover:bg-ds-raised",
          FOCUS,
        )}
      >
        <Icon name={open ? "x" : "menu"} size={20} />
        <span className="sr-only">
          {label}
          {shown ? `, ${badge} need attention` : ""}
        </span>
        {shown && (
          <span
            aria-hidden="true"
            className="ds-num absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-ds-accent px-1 text-center text-[10px] font-bold leading-4 text-ds-ink"
          >
            {badge}
          </span>
        )}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full z-50 max-h-[calc(100dvh-var(--ds-header-h)-var(--ds-tabbar-h))] overflow-y-auto border-b border-ds-text bg-ds-bg lg:left-auto lg:right-[var(--ds-gutter)] lg:max-h-[calc(100dvh-var(--ds-header-h))] lg:w-[360px] lg:border-x"
      >
        {children}
      </div>
    </div>
  );
}
