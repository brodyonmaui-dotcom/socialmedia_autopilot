"use client";

import { useState } from "react";
import { Badge, Button, Chip, Icon, ListRow } from "../../../components/ui/index.js";
import type { InboxRow } from "../../../lib/engagement/queries.js";
import { actionBadge, bucketChip, handleLabel, replyLabel, type CommentTab } from "../../../lib/inbox/view.js";
import { blockAuthorAction, markHandledAction, promoteShadowAction, sendManualAction } from "../actions.js";

/** Copies text to the clipboard; optional `onCopied` runs after (e.g. mark a DM draft copied). */
export function CopyButton({ text, onCopied, label = "Copy" }: { text: string; onCopied?: () => Promise<void>; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="px-4"
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
      {done ? <Icon name="check" size={16} /> : null}
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </Button>
  );
}

/** The stored draft / shadow / sent reply as a quiet well with a blue rule. */
export function ReplyWell({ label, text }: { label: string; text: string }) {
  return (
    <div className="border-l-2 border-ds-accent bg-ds-card px-4 py-3">
      <p className="ds-caps text-ds-muted">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-[16px] leading-normal text-ds-text">{text}</p>
    </div>
  );
}

const OUT_NOTE = "Goes out on the next worker tick if the worker is live and not killed.";

export function CommentCard({ row, tab, when }: { row: InboxRow; tab: CommentTab; when: string }) {
  const tabField = <input type="hidden" name="tab" value={tab} />;
  // One reply per comment, ever (unique comment_id + kind): a stored shadow reply can't get a manual twin.
  const canReply = !!row.draft && !row.isOwn && tab === "flagged";
  // Shadow tab: promote the stored shadow reply instead (one conditional update).
  const canPromote = tab === "shadow" && !!row.actionId && row.actionKind === "reply" && row.actionStatus === "shadow" && !!row.draft && !row.isOwn;
  const canHide = tab !== "sent" && row.bucket === "hide_flag" && row.platform === "instagram" && !row.isOwn;
  const chip = bucketChip(row.bucket);
  const status = tab === "sent" ? actionBadge(row.actionStatus) : null;

  return (
    <ListRow
      avatar={{ platform: row.platform }}
      title={handleLabel(row.authorHandle)}
      subtitle={when}
      trailing={
        status ? (
          <Badge tone={status.tone}>{status.label}</Badge>
        ) : chip ? (
          <Chip tone={chip.tone} className="ds-caps">
            {chip.label}
          </Chip>
        ) : undefined
      }
    >
      <div>
        {row.postLabel ? (
          <p className="ds-mono text-ds-faint">
            on{" "}
            {row.postUrl ? (
              <a href={row.postUrl} target="_blank" rel="noreferrer" className="text-ds-accent-fg underline underline-offset-2">
                {row.postLabel}
              </a>
            ) : (
              row.postLabel
            )}
          </p>
        ) : null}
        <p className="mt-2 whitespace-pre-wrap text-[18px] leading-snug text-ds-text">{row.text}</p>
        {row.reasons.length > 0 ? <p className="ds-mono mt-2 text-ds-muted">{row.reasons.join(" · ")}</p> : null}
      </div>

      {row.draft ? <ReplyWell label={replyLabel(tab)} text={row.draft} /> : null}

      {tab === "sent" && row.actionStatus ? (
        <div className="flex flex-col gap-2">
          <p className="ds-mono text-ds-faint">
            {row.actionKind} · {row.sentAt ? new Date(row.sentAt).toLocaleString() : "not yet"}
          </p>
          {(row.actionStatus === "failed" || row.actionStatus === "unknown") && row.lastError ? (
            <Chip wrap tone={row.actionStatus === "failed" ? "danger" : "warn"} className="flex w-full">
              {row.lastError}
            </Chip>
          ) : null}
        </div>
      ) : null}

      {tab === "shadow" ? <p className="ds-mono text-ds-faint">shadow mode: stored only</p> : null}

      {canReply || canPromote ? (
        <form action={canPromote ? promoteShadowAction.bind(null, row.actionId!) : sendManualAction.bind(null, row.commentId, "reply")}>
          {tabField}
          <Button type="submit" variant="outline" block arrow>
            Send this reply
          </Button>
          <p className="ds-mono mt-2 text-ds-faint">{OUT_NOTE}</p>
        </form>
      ) : null}

      {tab !== "sent" ? (
        <div className="flex flex-wrap gap-2">
          {row.draft ? <CopyButton text={row.draft} /> : <CopyButton text={row.text} label="Copy comment" />}
          {tab === "flagged" ? (
            <form action={markHandledAction.bind(null, row.commentId)}>
              {tabField}
              <Button type="submit" variant="outline" size="sm" className="px-4">
                <Icon name="check" size={16} />
                Mark done
              </Button>
            </form>
          ) : null}
          {canHide ? (
            <form action={sendManualAction.bind(null, row.commentId, "hide")}>
              {tabField}
              <Button type="submit" variant="outline" tone="danger" size="sm" className="px-4">
                Hide
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}

      {row.authorId && tab !== "sent" ? (
        <form action={blockAuthorAction.bind(null, row.platform, row.authorId)}>
          {tabField}
          <Button type="submit" variant="ghost" size="sm" className="-ml-4 px-4">
            Never auto-reply to this person
          </Button>
        </form>
      ) : null}
    </ListRow>
  );
}
