"use client";

import Link from "next/link";
import type { KeyboardEvent, ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";
import { Popover, type PopoverTriggerProps } from "./Popover.js";
import { nextIndex } from "./popover-position.js";

/**
 * One menu entry. Exactly one of: `href` (a link), `action` (a server action; `fields` become hidden
 * inputs), or `onSelect` (client callers only).
 */
export type MenuItem = {
  label: string;
  icon?: IconName;
  href?: string;
  action?: (fd: FormData) => void | Promise<void>;
  fields?: Record<string, string>;
  onSelect?: () => void;
  /** Marks the current choice (Dropdown) with a check and aria-current. */
  current?: boolean;
  tone?: "default" | "danger";
  disabled?: boolean;
};

const ITEM =
  "flex min-h-11 w-full items-center gap-3 rounded-ds-sm px-3 text-left text-[15px] text-ds-text hover:bg-ds-raised focus-visible:bg-ds-raised lg:min-h-9 lg:text-[14px]";

function focusItem(panel: HTMLElement, i: number) {
  const items = [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')];
  items[i]?.focus();
}

function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
  const panel = e.currentTarget;
  const items = [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')];
  const cur = items.indexOf(document.activeElement as HTMLElement);
  const n = nextIndex(e.key, cur, items.length);
  if (n != null) {
    e.preventDefault();
    items[n]?.focus();
  }
}

function ItemInner({ item }: { item: MenuItem }) {
  return (
    <>
      {item.icon ? <Icon name={item.icon} size={18} className="shrink-0 text-ds-muted" /> : null}
      <span className="min-w-0 flex-1">{item.label}</span>
      {item.current ? <Icon name="check" size={16} className="shrink-0 text-ds-accent-fg" /> : null}
    </>
  );
}

/** The item list (role="menu"): arrow keys, Home/End; Esc and outside click come from Popover. */
export function MenuList({ items, label, close }: { items: MenuItem[]; label: string; close: () => void }) {
  return (
    <div role="menu" aria-label={label} onKeyDown={onMenuKey} className="flex flex-col p-1">
      {items.map((item, i) => {
        const cls = cx(ITEM, FOCUS, item.tone === "danger" && "text-ds-danger", item.disabled && "pointer-events-none opacity-50");
        if (item.href) {
          return (
            <Link key={i} role="menuitem" href={item.href} aria-current={item.current ? "true" : undefined} className={cls} onClick={close}>
              <ItemInner item={item} />
            </Link>
          );
        }
        if (item.action) {
          return (
            <form key={i} action={item.action} role="none" onSubmit={() => setTimeout(close, 0)}>
              {item.fields && Object.entries(item.fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <button role="menuitem" type="submit" disabled={item.disabled} aria-disabled={item.disabled || undefined} className={cls}>
                <ItemInner item={item} />
              </button>
            </form>
          );
        }
        return (
          <button
            key={i}
            role="menuitem"
            type="button"
            disabled={item.disabled}
            aria-disabled={item.disabled || undefined}
            className={cls}
            onClick={() => {
              item.onSelect?.();
              close();
            }}
          >
            <ItemInner item={item} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Click-to-open action menu. Default trigger: a 40 px "⋯" icon button labelled `label`; pass `trigger`
 * (client callers) for a custom one. Focus moves to the first item on open (or the current one).
 */
export function Menu({
  items,
  label,
  icon = "dots",
  align = "end",
  width = 240,
  trigger,
}: {
  items: MenuItem[];
  /** Accessible name of the trigger and the menu ("Post actions"). */
  label: string;
  icon?: IconName;
  align?: "start" | "end";
  width?: number;
  trigger?: (p: PopoverTriggerProps) => ReactNode;
}) {
  return (
    <Popover
      role="menu"
      label={label}
      align={align}
      width={width}
      onOpen={(panel) => {
        const cur = items.findIndex((it) => it.current);
        focusItem(panel, cur >= 0 ? cur : 0);
      }}
      trigger={
        trigger ??
        ((p) => (
          <button
            {...p}
            type="button"
            aria-label={label}
            title={label}
            className={cx(
              "inline-flex size-11 shrink-0 items-center justify-center rounded-ds-sm text-ds-muted transition-colors duration-[var(--ds-dur)] ease-ds hover:bg-ds-raised hover:text-ds-text lg:size-9",
              FOCUS,
            )}
          >
            <Icon name={icon} size={20} />
          </button>
        ))
      }
    >
      {(close) => <MenuList items={items} label={label} close={close} />}
    </Popover>
  );
}
