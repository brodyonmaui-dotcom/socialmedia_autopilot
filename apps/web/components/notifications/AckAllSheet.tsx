"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmSheet, Icon, cx } from "../ui/index.js";
import { acknowledgeShownAction } from "../../app/alerts/actions.js";

export interface AckAllCopy {
  trigger: string;
  title: string;
  confirm: string;
  scope: string;
}

/**
 * "Acknowledge all" behind the design-system ConfirmSheet with the count. Sends exactly the ids on screen,
 * so an alert that arrived after the page loaded is never acknowledged unseen. Renders the trigger (and a
 * status line after it ran); sits in the Notifications page header.
 */
export function AckAllSheet({ ids, copy }: { ids: string[]; copy: AckAllCopy }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (ids.length === 0) return null;

  async function confirm() {
    setMsg(null);
    try {
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      const r = await acknowledgeShownAction(fd);
      setMsg(r.ok ? { ok: true, text: `Acknowledged ${r.count}.` } : { ok: false, text: r.reason.slice(0, 160) });
      if (r.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Something went wrong: reload." });
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-2 sm:items-end">
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={cx("flex items-start gap-2 text-[14px] leading-snug", msg.ok ? "text-ds-accent-fg" : "text-ds-danger")}>
          <Icon name={msg.ok ? "check" : "alert"} size={16} className="mt-0.5 shrink-0" />
          {msg.text}
        </p>
      ) : null}
      <div>
        <ConfirmSheet
          triggerLabel={copy.trigger}
          triggerVariant="outline"
          title={copy.title}
          confirmLabel={copy.confirm}
          onConfirm={confirm}
          body={
            <p>
              {copy.scope}. They move to Acknowledged (kept, not deleted). Alerts that arrived after this page loaded stay open.
            </p>
          }
        />
      </div>
    </div>
  );
}
