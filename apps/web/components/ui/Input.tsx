import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";

/** Shared look for text fields and selects (v2): sharp raised well with a 2px underline that turns accent on focus. */
export const FIELD =
  "block h-12 w-full bg-ds-raised px-4 text-[16px] text-ds-text placeholder:text-ds-faint " +
  "border-0 border-b-2 border-ds-line-strong transition-colors duration-300 ease-ds hover:border-ds-text focus:border-ds-accent " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-ds-danger";

export interface FieldMetaProps {
  label: string;
  helper?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
}

/** Ids + label/helper/error wiring shared by Input and Select. */
export function useFieldIds(id: string | undefined, name: string | undefined, helper: unknown, error: unknown) {
  const auto = useId();
  const fieldId = id ?? (name ? `f-${name}-${auto}` : `f${auto}`);
  const helperId = helper ? `${fieldId}-help` : undefined;
  const errorId = error ? `${fieldId}-err` : undefined;
  const describedBy = [errorId, helperId].filter(Boolean).join(" ") || undefined;
  return { fieldId, helperId, errorId, describedBy };
}

export function FieldShell({
  fieldId,
  label,
  hideLabel,
  helper,
  helperId,
  error,
  errorId,
  className,
  children,
}: {
  fieldId: string;
  label: string;
  hideLabel?: boolean;
  helper?: ReactNode;
  helperId?: string;
  error?: ReactNode;
  errorId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={fieldId} className={cx("ds-caps text-ds-muted", hideLabel && "sr-only")}>
        {label}
      </label>
      {children}
      {error && (
        <p id={errorId} className="flex items-center gap-1.5 text-[14px] text-ds-danger">
          <Icon name="alert" size={14} />
          {error}
        </p>
      )}
      {helper && (
        <p id={helperId} className="ds-mono text-ds-faint">
          {helper}
        </p>
      )}
    </div>
  );
}

export type InputProps = FieldMetaProps & Omit<InputHTMLAttributes<HTMLInputElement>, "children"> & { leading?: ReactNode };

/** Labelled text input. Errors set aria-invalid and are announced via aria-describedby. */
export function Input({ label, helper, error, hideLabel, id, name, className, leading, ...rest }: InputProps) {
  const { fieldId, helperId, errorId, describedBy } = useFieldIds(id, name, helper, error);
  const input = (
    <input
      id={fieldId}
      name={name}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={cx(FIELD, FOCUS, leading ? "pl-11" : undefined)}
      {...rest}
    />
  );
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
      {leading ? (
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ds-faint">{leading}</span>
          {input}
        </div>
      ) : (
        input
      )}
    </FieldShell>
  );
}

/** Search box: leading search icon, type=search, label visually hidden unless hideLabel={false}. */
export function SearchField({ hideLabel = true, ...rest }: Omit<InputProps, "type" | "leading">) {
  return <Input type="search" hideLabel={hideLabel} leading={<Icon name="search" size={18} />} {...rest} />;
}

export function PasswordInput(props: Omit<InputProps, "type">) {
  return <Input type="password" {...props} />;
}
