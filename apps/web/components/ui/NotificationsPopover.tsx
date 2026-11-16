"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";
import { IconButton } from "./IconButton.js";
import { Popover } from "./Popover.js";

export type NotificationItem = {
  id: string;
  /** Short kind label ("Failed", "Token health"). */
  kind: string;
  message: string;
  /** "5m ago". */
  age: string;
  urgent: boolean;
};

function AckButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cx(
        "inline-flex h-11 shrink-0 items-center rounded-ds-sm border border-ds-line-strong px-3 text-[13px] font-semibold text-ds-text hover:bg-ds-raised disabled:opacity-60 lg:h-8 lg:px-2.5",
        FOCUS,
      )}
    >
      {pending ? "…" : "Acknowledge"}
    </button>
  );
}

/**
 * The top bar's bell: a pop-over (a full-width sheet on phones) with the newest open alerts (max 6), each
 * with its message, age and an Acknowledge button, then "See all" → /notifications. The badge is the open count.
 * `ackAction` is the existing alerts server action (form field `id`).
 */
export function NotificationsPopover({
  items,
  openCount,
  ackAction,
}: {
  items: NotificationItem[];
  openCount: number;
  ackAction: (fd: FormData) => void | Promise<void>;
}) {
  const shown = items.slice(0, 6);
  return (
    <Popover
      label="Notifications"
      align="end"
      width={380}
      sheetOnPhone
      trigger={(p) => <IconButton {...p} icon="bell" label="Notifications" badge={openCount} badgeNoun="open" />}
    >
      {(close) => (
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-ds-line px-4 py-3">
            <h2 className="ds-heading">Notifications</h2>
            <span className="ds-num text-[13px] text-ds-muted">{openCount === 0 ? "None open" : `${openCount} open`}</span>
          </div>
          {shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <Icon name="check" size={20} className="text-ds-accent-fg" />
              <p className="text-[15px] text-ds-text">You&rsquo;re all caught up.</p>
              <p className="text-[13px] text-ds-muted">Failed posts, token problems and anything that needs you land here.</p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-ds-line">
              {shown.map((n) => (
                <li key={n.id} className="flex gap-3 px-4 py-3">
                  <Icon name={n.urgent ? "alert" : "bell"} size={18} className={cx("mt-0.5 shrink-0", n.urgent ? "text-ds-warn" : "text-ds-muted")} />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[14px] leading-snug text-ds-text">{n.message}</p>
                    <p className="mt-1 text-[12px] text-ds-muted">
                      {n.kind} · {n.age}
                    </p>
                  </div>
                  <form action={ackAction} className="shrink-0 self-center">
                    <input type="hidden" name="id" value={n.id} />
                    <AckButton />
                  </form>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-ds-line p-2">
            <Link
              href="/notifications"
              onClick={close}
              className={cx("flex min-h-11 items-center justify-center gap-1 rounded-ds-sm text-[14px] font-semibold text-ds-accent-fg hover:bg-ds-raised lg:min-h-9", FOCUS)}
            >
              See all
              <Icon name="chevronRight" size={16} />
            </Link>
          </div>
        </div>
      )}
    </Popover>
  );
}
