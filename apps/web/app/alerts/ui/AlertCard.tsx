import Link from "next/link";
import { PUSH_KINDS_DEFAULT, type AlertKind } from "@autopilot/core";
import { kindLabel, sourceLabel, type AlertView } from "../../../lib/alerts/queries.js";
import { BTN_GHOST } from "../../batches/ui/WarningChip.js";
import { acknowledgeAction } from "../actions.js";

// "Act soon" kinds (the default push set) get the red edge; the rest are informational.
const URGENT: ReadonlySet<AlertKind> = new Set(PUSH_KINDS_DEFAULT);

/** One alert. The message is shown as stored (sanitised at write time), as plain text. */
export function AlertCard({ alert, when, ackWhen }: { alert: AlertView; when: string; ackWhen?: string }) {
  const urgent = URGENT.has(alert.kind) && !alert.acknowledgedAt;
  return (
    <li className={`rounded-xl border p-3 ${urgent ? "border-red-300 dark:border-red-800" : "border-neutral-200 dark:border-neutral-800"}`}>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${urgent ? "bg-red-600 text-white" : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"}`}>
          {kindLabel(alert.kind)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-500">{sourceLabel(alert.source)}</span>
        <span className="text-sm text-neutral-500">{when}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-base">{alert.message.slice(0, 1000)}</p>
      {ackWhen ? <p className="mt-1 text-sm text-neutral-500">Acknowledged {ackWhen}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {alert.batchId ? (
          <Link href={`/batches/${alert.batchId}`} className="inline-flex min-h-11 items-center underline">
            Open batch
          </Link>
        ) : null}
        {!alert.acknowledgedAt ? (
          <form action={acknowledgeAction} className="ml-auto">
            <input type="hidden" name="id" value={alert.id} />
            <button className={BTN_GHOST}>Acknowledge</button>
          </form>
        ) : null}
      </div>
    </li>
  );
}
