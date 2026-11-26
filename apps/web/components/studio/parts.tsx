"use client";
import { useId } from "react";
import { cx, FOCUS } from "../ui/index.js";

/** Labelled range slider + number readout, 44 px tall hit area. Values in seconds or percent, caller formats. */
export function RangeField({ label, value, min, max, step = 0.1, onChange, display, className }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; display: string; className?: string }) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-semibold text-ds-text">{label}</label>
        <span className="ds-num text-[13px] text-ds-muted">{display}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className={cx("h-11 w-full cursor-pointer accent-ds-accent", FOCUS)} />
    </div>
  );
}

/** Colour picker: one 44 px button per colour (the swatch is data, so its fill is inline); the checked one gets a ring. */
export function Swatches({ label, colors, value, onChange, className }: { label: string; colors: readonly string[]; value: string; onChange: (c: string) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("flex flex-col gap-1", className)}>
      <span className="text-[13px] font-semibold text-ds-text">{label}</span>
      <div className="flex flex-wrap">
        {colors.map((c) => {
          const on = c.toUpperCase() === value.toUpperCase();
          return (
            <button key={c} type="button" role="radio" aria-checked={on} aria-label={c} onClick={() => onChange(c)} className={cx("grid size-11 place-items-center", FOCUS, "focus-visible:-outline-offset-2")}>
              <span className={cx("block size-7 border", on ? "border-ds-text ring-2 ring-ds-accent ring-offset-2 ring-offset-ds-card" : "border-ds-line-strong")} style={{ backgroundColor: c }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Seconds number box (decimal), 44 px tall. */
export function SecField({ label, value, onChange, min = 0, max, className }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; className?: string }) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-[13px] font-semibold text-ds-text">{label}</label>
      <input id={id} type="number" inputMode="decimal" min={min} max={max} step={0.1} value={value} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n); }} className={cx("ds-num h-11 w-full rounded-ds-sm border border-ds-line-strong bg-ds-card px-3 text-[16px] text-ds-text hover:border-ds-text", FOCUS)} />
    </div>
  );
}
