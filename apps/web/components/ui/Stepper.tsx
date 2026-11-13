"use client";

import { useState } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";
import { clamp, stepValue } from "./stepper-math.js";

export interface StepperProps {
  /** Used in the button labels ("Decrease X" / "Increase X") and as the group label. */
  label: string;
  value?: number;
  defaultValue?: number;
  onChange?: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** When set, a hidden input submits the current value with the form. */
  name?: string;
  disabled?: boolean;
  /** Optional formatter for the shown value (e.g. units). */
  format?: (n: number) => string;
  className?: string;
}

const STEP_BTN =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ds-text transition-colors duration-200 ease-ds hover:bg-ds-line active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

/** Dark pill − value +. Controlled (`value`) or uncontrolled (`defaultValue`). */
export function Stepper({
  label,
  value,
  defaultValue,
  onChange,
  min,
  max,
  step = 1,
  name,
  disabled = false,
  format,
  className,
}: StepperProps) {
  const [inner, setInner] = useState(() => clamp(defaultValue ?? min ?? 0, min, max));
  const current = value ?? inner;

  function press(dir: 1 | -1) {
    const next = stepValue(current, dir, { min, max, step });
    if (next === current) return;
    if (value === undefined) setInner(next);
    onChange?.(next);
  }

  const atMin = min !== undefined && current <= min;
  const atMax = max !== undefined && current >= max;

  return (
    <div
      role="group"
      aria-label={label}
      className={cx("inline-flex h-12 items-center gap-1 rounded-full bg-ds-raised px-0.5", disabled && "opacity-50", className)}
    >
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={disabled || atMin}
        onClick={() => press(-1)}
        className={cx(STEP_BTN, FOCUS)}
      >
        <Icon name="minus" size={18} strokeWidth={2} />
      </button>
      <output aria-live="polite" className="min-w-10 text-center text-[17px] font-bold text-ds-text ds-num">
        {format ? format(current) : current}
      </output>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={disabled || atMax}
        onClick={() => press(1)}
        className={cx(STEP_BTN, FOCUS)}
      >
        <Icon name="plus" size={18} strokeWidth={2} />
      </button>
      {name && <input type="hidden" name={name} value={String(current)} />}
    </div>
  );
}
