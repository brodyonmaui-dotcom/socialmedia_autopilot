import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.js";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> & {
  label: ReactNode;
  description?: ReactNode;
};

/** Shared box: sharp 22px square, black (invert) fill when checked; the mark is the sibling SVG. */
export const CHOICE_BOX =
  "peer size-[22px] shrink-0 appearance-none border border-ds-line-strong bg-ds-bg transition-colors duration-300 ease-ds " +
  "checked:border-ds-invert checked:bg-ds-invert disabled:cursor-not-allowed " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-focus";

export function ChoiceRow({
  input,
  mark,
  label,
  description,
  disabled,
  className,
}: {
  input: ReactNode;
  mark: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cx(
        "flex min-h-11 items-start gap-3 py-2.5",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <span className="relative mt-px inline-flex size-[22px] shrink-0">
        {input}
        {mark}
      </span>
      <span className="min-w-0">
        <span className="block text-[16px] font-medium leading-snug text-ds-text">{label}</span>
        {description && <span className="mt-0.5 block ds-mono leading-snug text-ds-faint">{description}</span>}
      </span>
    </label>
  );
}

/** Native checkbox, styled. Pass-through props (name, value, defaultChecked, required, ...). */
export function Checkbox({ label, description, className, disabled, ...rest }: CheckboxProps) {
  return (
    <ChoiceRow
      label={label}
      description={description}
      disabled={disabled}
      className={className}
      input={<input type="checkbox" disabled={disabled} className={CHOICE_BOX} {...rest} />}
      mark={
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          className="pointer-events-none absolute inset-0 m-auto size-4 text-ds-on-invert opacity-0 transition-opacity duration-300 ease-ds peer-checked:opacity-100"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="square"
          strokeLinejoin="miter"
        >
          <path d="M5 12.5 10 17 19 7" />
        </svg>
      }
    />
  );
}
