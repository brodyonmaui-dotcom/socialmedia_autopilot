"use client";

import { useId, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import { cx } from "./cx.js";

export type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "min" | "max"> & {
  label: string;
  hideLabel?: boolean;
  value?: number;
  defaultValue?: number;
  onChange?: (next: number) => void;
  min?: number;
  max?: number;
  /** Visible value next to the label, e.g. (n) => `${n}%`. */
  format?: (n: number) => string;
};

/*
 * Native range input. The 44px-tall input is the hit area; the 6px track is drawn on the
 * pseudo-elements. Accent fill = linear-gradient up to --pct (WebKit) / ::-moz-range-progress (Firefox).
 * Client component so the fill follows the knob live.
 */
const TRACK_WEBKIT =
  "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full " +
  "[&::-webkit-slider-runnable-track]:[background:linear-gradient(to_right,var(--color-ds-accent)_var(--pct),var(--color-ds-line)_var(--pct))]";
const THUMB_WEBKIT =
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:-mt-2 [&::-webkit-slider-thumb]:size-[22px] " +
  "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ds-paper [&::-webkit-slider-thumb]:shadow-ds-pop " +
  "[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-200 [&::-webkit-slider-thumb]:ease-ds active:[&::-webkit-slider-thumb]:scale-110";
const MOZ =
  "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-ds-line " +
  "[&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-ds-accent " +
  "[&::-moz-range-thumb]:size-[22px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ds-paper";

export function Slider({
  label,
  hideLabel = false,
  value,
  defaultValue,
  onChange,
  min = 0,
  max = 100,
  format,
  id,
  className,
  disabled,
  ...rest
}: SliderProps) {
  const auto = useId();
  const fieldId = id ?? `sl${auto}`;
  const [inner, setInner] = useState(defaultValue ?? min);
  const current = value ?? inner;
  const span = max - min || 1;
  const pct = Math.min(100, Math.max(0, ((current - min) / span) * 100));

  return (
    <div className={cx("flex flex-col gap-1", disabled && "opacity-50", className)}>
      <div className={cx("flex items-baseline justify-between gap-3", hideLabel && "sr-only")}>
        <label htmlFor={fieldId} className="ds-caps font-bold text-ds-muted">
          {label}
        </label>
        <span aria-hidden="true" className="text-[15px] text-ds-text ds-num">
          {format ? format(current) : current}
        </span>
      </div>
      <input
        id={fieldId}
        type="range"
        min={min}
        max={max}
        value={current}
        disabled={disabled}
        aria-valuetext={format ? format(current) : undefined}
        onChange={(e) => {
          const next = Number(e.currentTarget.value);
          if (value === undefined) setInner(next);
          onChange?.(next);
        }}
        style={{ "--pct": `${pct}%` } as CSSProperties}
        className={cx(
          "h-11 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-focus",
          TRACK_WEBKIT,
          THUMB_WEBKIT,
          MOZ,
        )}
        {...rest}
      />
    </div>
  );
}
