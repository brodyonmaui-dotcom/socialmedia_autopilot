"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";
import { IconButton } from "./IconButton.js";
import { Popover } from "./Popover.js";

export type NotificationItem = {
  id: string;
  /** Short kind label ("Failed", "Token health", "Instagram"). */
  kind: string;
  message: string;
  /** "5m ago". */
  age: string;
  urgent: boolean;
  /** The whole row links here (F20). */
  href?: string;
  /** The button text for the action ("Review replies"). Omitted: no action button, the row link only. */
  action?: string;
  /** Informational events can be acknowledged; live inbox rows can't (they clear when handled). */
  ackable?: boolean;
};

const ROW_ACTION = cx(
  "relative z-10 inline-flex h-11 shrink-0 items-center rounded-ds-sm border border-ds-line-strong px-3 text-[13px] font-semibold text-ds-text hover:bg-ds-raised lg:h-8 lg:px-2.5",
  FOCUS,
);

function AckButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cx(
        ROW_ACTION,
        "disabled:opacity-60",
      )}
    >
      {pending ? "…" : "Acknowledge"}
    </button>
  );
}

/**
 * The top bar's bell: a pop-over (a full-width sheet on phones) with live Inbox rows first, then open event
 * alerts (max 6 rows). A whole row is a link; its button is the action; Acknowledge only on events. "See all" → /notifications. The badge is the row count.
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
                <li key={n.id} className="relative flex gap-3 px-4 py-3 hover:bg-ds-raised/60">
                  <Icon name={n.urgent ? "alert" : "bell"} size={18} className={cx("mt-0.5 shrink-0", n.urgent ? "text-ds-warn" : "text-ds-muted")} />
                  <div className="min-w-0 flex-1">
                    {n.href ? (
                      <Link href={n.href} onClick={close} className={cx("line-clamp-2 text-[14px] leading-snug text-ds-text after:absolute after:inset-0 after:content-['']", FOCUS)}>
                        {n.message}
                      </Link>
                    ) : (
                      <p className="line-clamp-2 text-[14px] leading-snug text-ds-text">{n.message}</p>
                    )}
                    <p className="mt-1 text-[12px] text-ds-muted">
                      {n.kind} · {n.age}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {n.href && n.action ? (
                        <Link href={n.href} onClick={close} className={ROW_ACTION}>
                          {n.action}
                        </Link>
                      ) : null}
                      {n.ackable !== false ? (
                        <form action={ackAction} className="relative z-10">
                          <input type="hidden" name="id" value={n.id} />
                          <AckButton />
                        </form>
                      ) : null}
                    </div>
                  </div>
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
