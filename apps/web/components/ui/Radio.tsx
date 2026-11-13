import type { InputHTMLAttributes, ReactNode } from "react";
import { CHOICE_BOX, ChoiceRow } from "./Checkbox.js";

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> & {
  label: ReactNode;
  description?: ReactNode;
};

/** Native radio, styled as a rounded square (per reference) with a white dot when checked. Group with a shared `name`. */
export function Radio({ label, description, className, disabled, ...rest }: RadioProps) {
  return (
    <ChoiceRow
      label={label}
      description={description}
      disabled={disabled}
      className={className}
      input={<input type="radio" disabled={disabled} className={CHOICE_BOX} {...rest} />}
      mark={
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-auto size-2.5 rounded-full bg-ds-paper opacity-0 transition-opacity duration-200 ease-ds peer-checked:opacity-100"
        />
      }
    />
  );
}
