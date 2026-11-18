"use client";

import { useId, useState, type ReactNode } from "react";
import { Button, Textarea, cx } from "../ui/index.js";

export const MAX_REPLY = 300;

/**
 * The reply well + the item's button row. `mode="approve"`: the drafted reply in a raised well, "Approve &
 * send" (solid) and "Edit" (turns the well into a textarea in place). `mode="write"`: no draft, so the
 * textarea shows at once and the solid button is "Send reply". The form posts to `action` (the bound
 * approveAndSendAction); an empty/unchanged edit sends the stored draft. The server re-runs the reply lint;
 * `error` (item page) shows under the field. `extra` = the row's other buttons (their own forms).
 */
export function ReplyComposer({
  action,
  mode,
  draft,
  tab,
  filter,
  error,
  size = "md",
  label = "Drafted reply",
  extra,
}: {
  action: (fd: FormData) => void | Promise<void>;
  mode: "approve" | "write";
  draft: string | null;
  tab?: string;
  /** The list filter the form came from (hidden "filter" field; the action returns to that list). */
  filter?: string;
  error?: string;
  size?: "md" | "lg";
  label?: string;
  extra?: ReactNode;
}) {
  const formId = useId();
  const lg = size === "lg";
  // The item page opens the field at once when there is no draft; the list keeps cards short until asked.
  const [open, setOpen] = useState(Boolean(error) || (mode === "write" && lg));
  const [text, setText] = useState(draft ?? "");

  return (
    <div className="flex flex-col gap-3">
      <form id={formId} action={action}>
        {tab ? <input type="hidden" name="tab" value={tab} /> : null}
        {filter ? <input type="hidden" name="filter" value={filter} /> : null}
        {open ? (
          <div className="rounded-ds-sm bg-ds-raised p-3">
            <Textarea
              label={mode === "write" ? "Your reply" : label}
              name="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_REPLY}
              rows={lg ? 4 : 3}
              required
              placeholder={mode === "write" ? "Write a reply in your own words" : undefined}
              autoFocus={!error && !(mode === "write" && lg)}
              error={error}
              helper={`${text.trim().length} / ${MAX_REPLY} · no links, no places`}
            />
          </div>
        ) : mode === "write" ? null : (
          <div className="rounded-ds-sm bg-ds-raised px-3 py-2.5">
            <p className="ds-label text-ds-muted">{label}</p>
            <p className={cx("mt-1 whitespace-pre-wrap leading-snug text-ds-text", lg ? "text-[17px]" : "text-[15px]")}>{draft}</p>
          </div>
        )}
      </form>
      <div className={cx("flex flex-wrap items-center gap-2", lg && "flex-col items-stretch sm:flex-row sm:items-center")}>
        {!open && mode === "write" ? (
          <Button variant={lg ? "solid" : "outline"} size={lg ? "md" : "sm"} block={lg} className={lg ? "h-12 text-[16px] sm:w-auto sm:min-w-56" : undefined} aria-expanded={false} onClick={() => setOpen(true)}>
            Write a reply
          </Button>
        ) : (
          <Button type="submit" form={formId} variant="solid" size={lg ? "md" : "sm"} block={lg} className={lg ? "h-12 text-[16px] sm:w-auto sm:min-w-56" : undefined}>
            {mode === "write" ? "Send reply" : open ? "Send edited reply" : "Approve & send"}
          </Button>
        )}
        <div className={cx("flex flex-wrap items-center gap-2", !lg && "contents")}>
          {open && !(mode === "write" && lg) ? (
            <Button
              variant="outline"
              size={lg ? "md" : "sm"}
              aria-expanded
              onClick={() => {
                setText(draft ?? "");
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          ) : mode === "approve" ? (
            <Button variant="outline" size={lg ? "md" : "sm"} aria-expanded={false} onClick={() => setOpen(true)}>
              Edit
            </Button>
          ) : null}
          {extra}
        </div>
      </div>
    </div>
  );
}
