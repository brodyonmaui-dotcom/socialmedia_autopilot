import type { BatchItemView } from "../../../lib/batches/types.js";
import { formatDuration, toDatetimeLocal } from "../../../lib/batches/view-model.js";
import { approveAction, editAction, rejectAction, unapproveAction } from "../[id]/actions.js";
import { ItemForm } from "./ItemForm.js";
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, PlatformBadge, StatusPill, WarningChip } from "./WarningChip.js";

export function PostCard({ item, time, timeZone, postUrl }: { item: BatchItemView; time: string | null; timeZone: string; postUrl?: string | undefined }) {
  const firstBlock = item.warnings.find((w) => w.severity === "block");
  const meta = [item.media.label, formatDuration(item.media.durationS), item.media.pillar].filter(Boolean).join(" · ");
  const ids = [item.id];

  return (
    <li className={`rounded-xl border p-3 ${firstBlock ? "border-red-300 dark:border-red-900" : "border-neutral-200 dark:border-neutral-800"}`} data-item={item.id}>
      <div className="flex items-center gap-2">
        <PlatformBadge platform={item.platform} />
        <span className="text-lg font-semibold tabular-nums">{time ?? "no time"}</span>
        <span className="ml-auto">
          <StatusPill status={item.status} />
        </span>
      </div>
      <p className="mt-1 text-sm text-neutral-500 [overflow-wrap:anywhere]">{meta}</p>

      {item.warnings.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {item.warnings.map((w, i) => (
            <WarningChip key={i} w={w} />
          ))}
        </ul>
      ) : null}

      <ItemForm
        batchId={item.batchId}
        itemId={item.id}
        isYoutube={item.platform === "youtube"}
        caption={item.caption}
        title={item.title}
        scheduledLocal={toDatetimeLocal(item.scheduledFor, timeZone)}
        editable={item.editable}
        action={editAction}
      />

      {item.handedOff ? (
        item.status === "published" && postUrl ? (
          <a href={postUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center text-base underline">
            View the post
          </a>
        ) : (
          <p className="mt-3 text-sm text-neutral-500">scheduled on the platform; change it in Studio/TikTok</p>
        )
      ) : item.status === "draft" ? (
        <div className="mt-3">
          <div className="flex gap-2">
            <form action={approveAction.bind(null, item.batchId, ids)} className="flex-1">
              <button className={`${BTN_PRIMARY} w-full`} disabled={!!firstBlock} title={firstBlock?.message}>
                Approve
              </button>
            </form>
            <form action={rejectAction.bind(null, item.batchId, ids)}>
              <button className={BTN_DANGER}>Reject</button>
            </form>
          </div>
          {firstBlock ? <p className="mt-1 text-sm text-red-700 dark:text-red-300">Can&apos;t approve: {firstBlock.message}</p> : null}
        </div>
      ) : item.status === "approved" || item.status === "queued" ? (
        <div className="mt-3 flex gap-2">
          <form action={unapproveAction.bind(null, item.batchId, ids)} className="flex-1">
            <button className={`${BTN_GHOST} w-full`}>Pull back</button>
          </form>
          <form action={rejectAction.bind(null, item.batchId, ids)}>
            <button className={BTN_DANGER}>Reject</button>
          </form>
        </div>
      ) : null}
    </li>
  );
}
