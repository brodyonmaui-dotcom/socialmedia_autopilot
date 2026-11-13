"use client";

import { useState } from "react";
import type { InboxRow } from "../../../lib/engagement/queries.js";
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, PlatformBadge } from "../../batches/ui/WarningChip.js";
import { blockAuthorAction, markHandledAction, promoteShadowAction, sendManualAction } from "../actions.js";

const BUCKET_TONE: Record<string, string> = {
  flag: "bg-red-600 text-white",
  hide_flag: "bg-red-900 text-white",
  simple_positive: "bg-green-600 text-white",
  negative: "bg-amber-500 text-white",
};

const STATUS_TONE: Record<string, string> = {
  sent: "bg-emerald-600 text-white",
  failed: "bg-red-600 text-white",
  unknown: "bg-amber-500 text-white",
  shadow: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
};

/** Copies text to the clipboard; optional `onCopied` runs after (e.g. mark a DM draft copied). */
export function CopyButton({ text, onCopied, label = "Copy" }: { text: string; onCopied?: () => Promise<void>; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={BTN_GHOST}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
          if (onCopied) await onCopied();
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function CommentCard({ row, tab, when }: { row: InboxRow; tab: "flagged" | "shadow" | "sent"; when: string }) {
  const tabField = <input type="hidden" name="tab" value={tab} />;
  // One reply per comment, ever (unique comment_id + kind): a stored shadow reply can't get a manual twin.
  const canReply = !!row.draft && !row.isOwn && tab === "flagged";
  // Shadow tab: promote the stored shadow reply instead (one conditional update).
  const canPromote = tab === "shadow" && !!row.actionId && row.actionKind === "reply" && row.actionStatus === "shadow" && !!row.draft && !row.isOwn;
  const canHide = tab !== "sent" && row.bucket === "hide_flag" && row.platform === "instagram" && !row.isOwn;

  return (
    <li className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <PlatformBadge platform={row.platform} />
        <span className="font-semibold">{row.authorHandle ? `@${row.authorHandle}` : "unknown author"}</span>
        <span className="text-sm text-neutral-500">{when}</span>
        {row.bucket ? (
          <span className={`ml-auto rounded-full px-2 py-0.5 text-sm font-medium ${BUCKET_TONE[row.bucket] ?? ""}`}>{row.bucket.replace("_", " ")}</span>
        ) : null}
      </div>
      {row.postLabel ? (
        <p className="mt-1 text-sm text-neutral-500">
          on{" "}
          {row.postUrl ? (
            <a href={row.postUrl} target="_blank" rel="noreferrer" className="underline">
              {row.postLabel}
            </a>
          ) : (
            row.postLabel
          )}
        </p>
      ) : null}
      <p className="mt-2 whitespace-pre-wrap text-base">{row.text}</p>
      {row.reasons.length > 0 ? <p className="mt-1 text-sm text-neutral-500">{row.reasons.join(" · ")}</p> : null}

      {row.draft ? (
        <p className="mt-2 rounded-lg bg-neutral-100 p-2 text-base dark:bg-neutral-900">
          <span className="text-sm text-neutral-500">{tab === "shadow" ? "would reply: " : tab === "sent" ? "reply: " : "draft: "}</span>
          {row.draft}
        </p>
      ) : null}

      {tab === "sent" && row.actionStatus ? (
        <div className="mt-2 text-sm">
          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_TONE[row.actionStatus] ?? "bg-sky-100 text-sky-800"}`}>{row.actionStatus}</span>
          <span className="ml-2 text-neutral-500">
            {row.actionKind} · {row.sentAt ? new Date(row.sentAt).toLocaleString() : "not yet"}
          </span>
          {(row.actionStatus === "failed" || row.actionStatus === "unknown") && row.lastError ? (
            <p className="mt-1 text-red-700 dark:text-red-300">{row.lastError}</p>
          ) : null}
        </div>
      ) : null}

      {tab !== "sent" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {row.draft ? <CopyButton text={row.draft} /> : <CopyButton text={row.text} label="Copy comment" />}
          {tab === "flagged" ? (
            <form action={markHandledAction.bind(null, row.commentId)}>
              {tabField}
              <button className={BTN_GHOST}>Mark done</button>
            </form>
          ) : null}
          {canHide ? (
            <form action={sendManualAction.bind(null, row.commentId, "hide")}>
              {tabField}
              <button className={BTN_DANGER}>Hide</button>
            </form>
          ) : null}
        </div>
      ) : null}

      {canReply ? (
        <form action={sendManualAction.bind(null, row.commentId, "reply")} className="mt-2">
          {tabField}
          <button className={`${BTN_PRIMARY} w-full`}>Send this reply</button>
          <p className="mt-1 text-sm text-neutral-500">goes out on the next worker tick if the worker is live and not killed</p>
        </form>
      ) : null}

      {tab === "shadow" ? <p className="mt-2 text-sm text-neutral-500">shadow mode: stored only</p> : null}
      {canPromote ? (
        <form action={promoteShadowAction.bind(null, row.actionId!)} className="mt-2">
          {tabField}
          <button className={`${BTN_PRIMARY} w-full`}>Send this reply</button>
          <p className="mt-1 text-sm text-neutral-500">goes out on the next worker tick if the worker is live and not killed</p>
        </form>
      ) : null}

      {row.authorId && tab !== "sent" ? (
        <form action={blockAuthorAction.bind(null, row.platform, row.authorId)} className="mt-2">
          {tabField}
          <button className="min-h-11 text-sm text-neutral-500 underline">Never auto-reply to this person</button>
        </form>
      ) : null}
    </li>
  );
}
