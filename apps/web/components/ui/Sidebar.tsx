"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";
import { IconButton } from "./IconButton.js";
import { Wordmark } from "./PageHeader.js";
import { createSidebarController, type SidebarController } from "./sidebar-timing.js";

/** Same shapes as components/app-nav.ts (kept structural so ui/ doesn't import app code). */
export type SidebarLink = { id: string; label: string; href: string; badge?: number };
export type SidebarEntry = SidebarLink & { icon: IconName; children?: SidebarLink[] };

type Mode = "desktop" | "drawer";
const DESKTOP = "(min-width: 1024px) and (hover: hover) and (pointer: fine)";
export const SIDEBAR_ID = "app-sidebar";

type Ctx = { open: boolean; mode: Mode; ctl: SidebarController; menuBtn: React.RefObject<HTMLButtonElement | null>; openedByButton: React.MutableRefObject<boolean> };
const ShellCtx = createContext<Ctx | null>(null);

function useShell(): Ctx {
  const c = useContext(ShellCtx);
  if (!c) throw new Error("Sidebar parts must sit inside <SidebarProvider>");
  return c;
}

/** Holds the sidebar's open state for the top-bar menu button and the panel. */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("drawer");
  const ctl = useMemo(() => createSidebarController(setOpen), []);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const openedByButton = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const sync = () => setMode(mq.matches ? "desktop" : "drawer");
    sync();
    mq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      ctl.dispose();
    };
  }, [ctl]);
  return <ShellCtx.Provider value={{ open, mode, ctl, menuBtn, openedByButton }}>{children}</ShellCtx.Provider>;
}

/** The top bar's 44 px menu button (icon only). */
export function MenuButton({ className }: { className?: string }) {
  const { open, ctl, menuBtn, openedByButton } = useShell();
  return (
    <IconButton
      ref={menuBtn}
      icon="menu"
      bare
      size="lg"
      label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      aria-controls={SIDEBAR_ID}
      className={className}
      onClick={() => {
        openedByButton.current = !open;
        ctl.toggle();
      }}
    />
  );
}

const ITEM =
  "flex min-h-11 w-full items-center gap-3 rounded-full px-3 text-[15px] font-semibold text-ds-text transition-colors duration-[var(--ds-dur)] ease-ds hover:bg-ds-raised";

function CountPill({ n }: { n?: number }) {
  if (!n) return null;
  return <span className="ds-num ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ds-accent px-1.5 text-[11px] font-bold text-ds-ink">{n > 99 ? "99+" : n}</span>;
}

function Group({ entry, currentHref, startOpen, onNavigate }: { entry: SidebarEntry; currentHref: string | null; startOpen: boolean; onNavigate: () => void }) {
  const [expanded, setExpanded] = useState(startOpen);
  const listId = useId();
  return (
    <li>
      <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)} className={cx(ITEM, FOCUS)}>
        <Icon name={entry.icon} size={20} className="shrink-0" />
        <span className="min-w-0 flex-1 text-left">{entry.label}</span>
        <Icon name="chevronDown" size={16} className={cx("shrink-0 text-ds-muted transition-transform duration-[var(--ds-dur)] ease-ds", expanded && "rotate-180")} />
      </button>
      <ul id={listId} hidden={!expanded} className="mt-0.5 flex flex-col gap-0.5 pl-8">
        {entry.children!.map((c) => {
          const current = c.href === currentHref;
          return (
            <li key={c.href}>
              <Link
                href={c.href}
                aria-current={current ? "page" : undefined}
                onClick={onNavigate}
                className={cx(ITEM, "min-h-10 font-medium", current ? "bg-ds-raised" : "text-ds-muted hover:text-ds-text", FOCUS)}
              >
                <span className="min-w-0 flex-1">{c.label}</span>
                <CountPill n={c.badge} />
              </Link>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/**
 * The v3 sidebar: 264 px, card fill, hairline right edge, pop shadow; overlays content (never reflows).
 * Desktop (≥ 1024 px, fine pointer): a 12 px hot zone on the left edge opens it; it closes 2.5 s after the
 * pointer leaves (see sidebar-timing.ts); Esc closes at once. Phone/touch: a drawer with a scrim and a
 * focus trap; the scrim, a link or Esc closes it and focus returns to the menu button.
 */
export function Sidebar({
  nav,
  currentHref,
  openGroups,
  logoutAction,
}: {
  nav: SidebarEntry[];
  /** Href of the current page's link (gets aria-current="page"). */
  currentHref: string | null;
  /** Group ids that start expanded (the one holding the current page). */
  openGroups: string[];
  /** Server action for "Log out". */
  logoutAction: (fd: FormData) => void | Promise<void>;
}) {
  const { open, mode, ctl, menuBtn, openedByButton } = useShell();
  const panel = useRef<HTMLDivElement>(null);
  const desktop = mode === "desktop";

  const closeAndReturn = useCallback(() => {
    const inside = panel.current?.contains(document.activeElement);
    ctl.escape();
    if (inside || !desktop) menuBtn.current?.focus();
  }, [ctl, desktop, menuBtn]);

  // Esc closes from anywhere while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") closeAndReturn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeAndReturn]);

  // Opened from the menu button: move focus to the current link (or the first one).
  useEffect(() => {
    if (!open || !openedByButton.current) return;
    openedByButton.current = false;
    const p = panel.current;
    const target = p?.querySelector<HTMLElement>('[aria-current="page"]') ?? p?.querySelector<HTMLElement>("a,button");
    requestAnimationFrame(() => target?.focus());
  }, [open, openedByButton]);

  // Desktop: a click outside the open panel (and not on the menu button) closes it.
  useEffect(() => {
    if (!open || !desktop) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || menuBtn.current?.contains(t)) return;
      ctl.close();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, desktop, ctl, menuBtn]);

  // Drawer: trap Tab inside the panel.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (desktop || e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled])")].filter((el) => !el.closest("[hidden]"));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const onNavigate = () => ctl.close();

  return (
    <>
      {desktop && !open && (
        // pointermove (not pointerenter): a cursor that merely rests at the edge while the page loads doesn't open it.
        <div aria-hidden="true" className="fixed inset-y-0 left-0 z-[45] w-3" onPointerMove={() => ctl.pointerEnter()} onPointerLeave={() => ctl.pointerLeave()} />
      )}
      {!desktop && open && <div aria-hidden="true" className="ds-fade fixed inset-0 z-[55] bg-ds-scrim" onClick={closeAndReturn} />}
      <div
        ref={panel}
        id={SIDEBAR_ID}
        role={desktop ? undefined : "dialog"}
        aria-modal={desktop ? undefined : open}
        aria-label="Menu"
        inert={!open}
        onKeyDown={onKeyDown}
        onPointerEnter={desktop ? () => ctl.pointerEnter() : undefined}
        onPointerLeave={desktop ? () => ctl.pointerLeave() : undefined}
        onFocus={() => ctl.focusIn()}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) ctl.focusOut();
        }}
        className={cx(
          "fixed inset-y-0 left-0 z-[60] flex w-[var(--ds-sidebar-w)] max-w-[86vw] flex-col border-r border-ds-line bg-ds-card shadow-ds-pop transition-transform duration-[var(--ds-dur)] ease-ds",
          open ? "translate-x-0" : "-translate-x-[calc(100%_+_48px)]",
        )}
      >
        <div className="flex h-[var(--ds-topbar-h)] shrink-0 items-center gap-1 px-[var(--ds-gutter)]">
          <IconButton icon="x" bare size="lg" label="Close menu" onClick={closeAndReturn} className="-ml-2.5" />
          <Link href="/" onClick={onNavigate} className={cx("rounded-ds-sm px-1 py-1", FOCUS)}>
            <Wordmark />
          </Link>
        </div>
        <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
          <ul className="flex flex-col gap-0.5">
            {nav.map((e) =>
              e.children ? (
                <Group key={e.id} entry={e} currentHref={currentHref} startOpen={openGroups.includes(e.id)} onNavigate={onNavigate} />
              ) : (
                <li key={e.id}>
                  <Link
                    href={e.href}
                    aria-current={e.href === currentHref ? "page" : undefined}
                    onClick={onNavigate}
                    className={cx(ITEM, e.href === currentHref && "bg-ds-raised", FOCUS)}
                  >
                    <Icon name={e.icon} size={20} className="shrink-0" />
                    <span className="min-w-0 flex-1">{e.label}</span>
                    <CountPill n={e.badge} />
                  </Link>
                </li>
              ),
            )}
          </ul>
        </nav>
        <form action={logoutAction} className="shrink-0 border-t border-ds-line p-3">
          <button type="submit" className={cx(ITEM, "text-ds-muted hover:text-ds-text", FOCUS)}>
            <Icon name="logout" size={20} className="shrink-0" />
            Log out
          </button>
        </form>
      </div>
    </>
  );
}
