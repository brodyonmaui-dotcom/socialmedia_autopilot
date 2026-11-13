"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BTN_GHOST, BTN_PRIMARY } from "../../batches/ui/WarningChip.js";
import { ConfirmSheet } from "../../handoff/ui/ConfirmSheet.js";
import { acknowledgeShownAction } from "../actions.js";

/** "Acknowledge all shown" behind a confirm sheet with the count. Sends exactly the ids on screen. */
export function AckAllSheet({ ids, scope }: { ids: string[]; scope: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (ids.length === 0) return null;
  const n = ids.length;

  async function confirm() {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      for (const id of ids) fd.append("id", id);
      const r = await acknowledgeShownAction(fd);
      setMsg(r.ok ? { ok: true, text: `Acknowledged ${r.count}.` } : { ok: false, text: r.reason.slice(0, 160) });
      setOpen(false);
      if (r.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Something went wrong: reload." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button type="button" className={`${BTN_GHOST} w-full`} disabled={busy} onClick={() => setOpen(true)}>
        Acknowledge all shown ({n})
      </button>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
          {msg.text}
        </p>
      ) : null}
      <ConfirmSheet
        open={open}
        title={`Acknowledge ${n} alert${n === 1 ? "" : "s"}?`}
        confirmLabel={`Confirm: acknowledge ${n}`}
        confirmClass={BTN_PRIMARY}
        busy={busy}
        onClose={() => setOpen(false)}
        onConfirm={confirm}
      >
        <p className="mt-1 text-base text-neutral-600 dark:text-neutral-300">
          {scope}. They move to Acknowledged (kept, not deleted). Alerts that arrived after this page loaded stay open.
        </p>
      </ConfirmSheet>
    </div>
  );
}
