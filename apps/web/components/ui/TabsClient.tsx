"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { cx, FOCUS } from "./cx.js";
import { TAB_BAR, tabSegment, TabCount } from "./tab-styles.js";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  ariaLabel: string;
  className?: string;
}

/** Client segmented tabs (role=tablist). Arrow keys / Home / End move and select. Render panels yourself from `value`/`onChange`. */
export function Tabs({ items, value, defaultValue, onChange, ariaLabel, className }: TabsProps) {
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id ?? "");
  const current = value ?? inner;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const base = useId();

  function select(id: string) {
    if (value === undefined) setInner(id);
    if (id !== current) onChange?.(id);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const n = items.length;
    let to = -1;
    if (e.key === "ArrowRight") to = (i + 1) % n;
    else if (e.key === "ArrowLeft") to = (i - 1 + n) % n;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    const item = items[to];
    if (!item) return;
    select(item.id);
    refs.current[to]?.focus();
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className={cx(TAB_BAR, className)}>
      {items.map((item, i) => {
        const active = item.id === current;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${base}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => select(item.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(tabSegment(active), FOCUS, "focus-visible:-outline-offset-4")}
          >
            {item.label}
            {item.count !== undefined && <TabCount count={item.count} />}
          </button>
        );
      })}
    </div>
  );
}
