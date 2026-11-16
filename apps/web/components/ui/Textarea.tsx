import type { TextareaHTMLAttributes } from "react";
import { cx, FOCUS } from "./cx.js";
import { FIELD, FieldShell, useFieldIds, type FieldMetaProps } from "./Input.js";

export type TextareaProps = FieldMetaProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "children">;

/**
 * Labelled multi-line field (v3): the Input look (card fill, control-border hairline, 8 px radius, 16 px
 * text so iOS doesn't zoom), auto height from `rows`, resizable vertically only. Errors set aria-invalid
 * and are announced via aria-describedby, shown under the field.
 */
export function Textarea({ label, helper, error, hideLabel, id, name, className, rows = 3, ...rest }: TextareaProps) {
  const { fieldId, helperId, errorId, describedBy } = useFieldIds(id, name, helper, error);
  return (
    <FieldShell fieldId={fieldId} label={label} hideLabel={hideLabel} helper={helper} helperId={helperId} error={error} errorId={errorId} className={className}>
      <textarea
        id={fieldId}
        name={name}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(FIELD, FOCUS, "h-auto min-h-24 resize-y py-2.5 leading-snug")}
        {...rest}
      />
    </FieldShell>
  );
}
