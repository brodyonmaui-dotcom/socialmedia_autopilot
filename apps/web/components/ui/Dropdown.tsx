"use client";

import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";
import { Menu, type MenuItem } from "./Menu.js";

export type DropdownOption = { label: string; href: string; current?: boolean };

/**
 * A button showing the current value ("This week ▾") plus a Menu of links. Every option is a URL
 * (e.g. `?range=last-week`), so the choice lives in the address, not in client state.
 * `label` names the control for screen readers ("Range: This week").
 */
export function Dropdown({
  label,
  options,
  align = "end",
  size = "md",
}: {
  label: string;
  options: DropdownOption[];
  align?: "start" | "end";
  size?: "md" | "sm";
}) {
  const current = options.find((o) => o.current) ?? options[0];
  const items: MenuItem[] = options.map((o) => ({ label: o.label, href: o.href, current: o === current }));
  return (
    <Menu
      label={label}
      items={items}
      align={align}
      width={220}
      trigger={(p) => (
        <button
          {...p}
          type="button"
          aria-label={`${label}: ${current?.label ?? ""}`}
          className={cx(
            "inline-flex shrink-0 items-center gap-1.5 rounded-ds-sm border border-ds-line-strong bg-ds-card font-semibold text-ds-text transition-colors duration-[var(--ds-dur)] ease-ds hover:bg-ds-raised",
            size === "sm" ? "h-11 px-3 text-[14px] lg:h-8 lg:px-2.5 lg:text-[13px]" : "h-11 px-3.5 text-[14px] lg:h-10",
            FOCUS,
          )}
        >
          {current?.label}
          <Icon name="chevronDown" size={16} className="text-ds-muted" />
        </button>
      )}
    />
  );
}
