"use client";

import { useId, useState } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";
import { nextToggleState } from "./toggle-state.js";

export interface ToggleProps {
  label: string;
  hideLabel?: boolean;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (next: boolean) => void;
  /** When set, a hidden input submits `value` (default "on") while checked, nothing while off. */
  name?: string;
  value?: string;
  disabled?: boolean;
  variant?: "plain" | "icon" | "text";
  description?: string;
  className?: string;
}

/** On/off switch: `<button role="switch">`, controlled (`checked`) or uncontrolled (`defaultChecked`). */
export function Toggle({
  label,
  hideLabel = false,
  checked,
  defaultChecked = false,
  onChange,
  name,
  value = "on",
  disabled = false,
  variant = "plain",
  description,
  className,
}: ToggleProps) {
  const [inner, setInner] = useState(defaultChecked);
  const on = checked ?? inner;
  const id = useId();
  const labelId = `${id}-label`;
  const descId = description ? `${id}-desc` : undefined;

  function press() {
    const next = nextToggleState(on, disabled);
    if (next === on) return;
    if (checked === undefined) setInner(next);
    onChange?.(next);
  }

  return (
    <div className={cx("flex min-h-11 items-center justify-between gap-4", disabled && "opacity-50", className)}>
      <div className={cx("min-w-0", hideLabel && "sr-only")}>
        <span id={labelId} className="block text-[17px] leading-snug text-ds-text">
          {label}
        </span>
        {description && (
          <span id={descId} className="block text-[15px] leading-snug text-ds-muted">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        aria-describedby={descId}
        disabled={disabled}
        onClick={press}
        className={cx(
          "relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
          FOCUS,
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "relative block h-8 w-[52px] rounded-full transition-colors duration-200 ease-ds",
            on ? "bg-ds-accent" : "bg-ds-raised ring-1 ring-ds-line-strong",
          )}
        >
          {variant === "icon" && (
            <>
              <Icon name="check" size={14} strokeWidth={2.5} className={cx("absolute left-2 top-[9px] text-ds-ink", !on && "opacity-0")} />
              <Icon name="x" size={14} strokeWidth={2.5} className={cx("absolute right-2 top-[9px] text-ds-faint", on && "opacity-0")} />
            </>
          )}
          {variant === "text" && (
            <span
              className={cx(
                "absolute top-1/2 -translate-y-1/2 text-[9px] font-bold uppercase leading-none tracking-wider",
                on ? "left-2 text-ds-ink" : "right-1.5 text-ds-faint",
              )}
            >
              {on ? "On" : "Off"}
            </span>
          )}
          <span
            className={cx(
              "absolute left-1 top-1 size-6 rounded-full bg-ds-paper shadow-sm transition-transform duration-200 ease-ds",
              on && "translate-x-5",
            )}
          />
        </span>
      </button>
      {name && on && <input type="hidden" name={name} value={value} />}
    </div>
  );
}
