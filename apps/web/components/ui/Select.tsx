import type { ReactNode, SelectHTMLAttributes } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";
import { FIELD, FieldShell, useFieldIds, type FieldMetaProps } from "./Input.js";

export type SelectProps = FieldMetaProps & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode };

/** Native <select>, styled like Input with a chevron overlay. Pass <option>s as children. */
export function Select({ label, helper, error, hideLabel, id, name, className, children, ...rest }: SelectProps) {
  const { fieldId, helperId, errorId, describedBy } = useFieldIds(id, name, helper, error);
  return (
    <FieldShell
      fieldId={fieldId}
      label={label}
      hideLabel={hideLabel}
      helper={helper}
      helperId={helperId}
      error={error}
      errorId={errorId}
      className={className}
    >
      <div className="relative">
        <select
          id={fieldId}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(FIELD, FOCUS, "cursor-pointer appearance-none pr-11")}
          {...rest}
        >
          {children}
        </select>
        <Icon
          name="chevronDown"
          size={18}
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-ds-muted"
        />
      </div>
    </FieldShell>
  );
}
