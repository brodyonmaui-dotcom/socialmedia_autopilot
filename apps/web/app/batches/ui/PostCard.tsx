import {
  Badge,
  Button,
  Chip,
  FramedImage,
  Icon,
  PLATFORM_NAME,
  PlatformLogo,
  Readout,
  buttonClasses,
  cx,
} from "../../../components/ui/index.js";
import Link from "next/link";
import { cardWarnings, handoffText, isStuck, itemStatusBadge, keyTailLabel, pastTimeChip, stuckActions } from "../../../lib/batches/card-view.js";
import type { BatchItemView } from "../../../lib/batches/types.js";
import { formatDuration, scheduledLabel, toDatetimeLocal } from "../../../lib/batches/view-model.js";
import { approveAction, editAction, rejectAction, unapproveAction } from "../[id]/actions.js";
import { ItemForm } from "./ItemForm.js";
import { CELL } from "./nav.js";
import { WarningLine } from "./Notice.js";
import { ResetSheet } from "./ResetSheet.js";

/**
 * "Batch card (proposed)" as a bordered grid cell: placeholder preview (1 of 4 cols / 2 of 6), the
 * time, title, caption and chips, then a full-width footer with warnings and the actions for the status.
 * failed/unknown get the F11 panel (attempts, sanitised last error, the two buttons) instead.
 */
export function PostCard({
  item,
  time,
  timeZone,
  index,
  dayLabel,
  openReset,
  now = new Date(),
}: {
  item: BatchItemView;
  time: string | null;
  timeZone: string;
  /** "01" within its day. */
  index?: string;
  /** "Mon 16 Nov" (omitted for untimed). */
  dayLabel?: string;
  /** Open the reset sheet on load (?reset=<itemId>). */
  openReset?: boolean;
  /** For the past-time chip (draft whose time has gone by). */
  now?: Date;
}) {
  const firstBlock = item.warnings.find((w) => w.severity === "block");
  const ids = [item.id];
  const badge = itemStatusBadge(item.status);
  const stuck = isStuck(item.status);
  const actions = stuckActions(item);
  const pastTime = pastTimeChip(item, now);
  const warnings = cardWarnings(item.warnings, pastTime != null);
  const duration = formatDuration(item.media.durationS);
  const postUrl = item.platformPostUrl ?? undefined;
  const handoff = handoffText(item, !!postUrl);
  const heading = item.platform === "youtube" && item.title ? item.title : item.media.label;
  const rejectBtn = (
    <form action={rejectAction.bind(null, item.batchId, ids)}>
      <Button type="submit" variant="icon" tone="danger" aria-label={`Reject ${PLATFORM_NAME[item.platform]} post`} title="Reject">
        <Icon name="x" />
      </Button>
    </form>
  );

  let primary: React.ReactNode = null;
  let danger: React.ReactNode = null;
  if (!item.handedOff && item.status === "draft") {
    primary = (
      <form action={approveAction.bind(null, item.batchId, ids)}>
        <Button type="submit" variant="outline" block arrow disabled={!!firstBlock} title={firstBlock?.message}>
          Approve
        </Button>
      </form>
    );
    danger = rejectBtn;
  } else if (!item.handedOff && (item.status === "approved" || item.status === "queued")) {
    primary = (
      <form action={unapproveAction.bind(null, item.batchId, ids)}>
        <Button type="submit" variant="outline" block>
          Pull back
        </Button>
      </form>
    );
    danger = rejectBtn;
  }

  const hasFooter = warnings.length > 0 || pastTime != null || stuck || !!postUrl || !!handoff || primary != null || item.editable;

  return (
    <li
      data-item={item.id}
      className={cx(CELL, "col-span-4 grid grid-cols-4 border lg:col-span-6 lg:grid-cols-6", firstBlock || item.status === "failed" ? "border-ds-danger/60" : "border-ds-line")}
    >
      <div className="col-span-1 min-w-0 border-r border-ds-line lg:col-span-2">
        <FramedImage alt={`${item.media.label} preview (placeholder)`} ratio="9/16">
          {duration ? <span className="ds-mono absolute bottom-3 right-3 bg-ds-invert px-1.5 py-0.5 text-ds-on-invert">{duration}</span> : null}
        </FramedImage>
      </div>

      <div className="col-span-3 flex min-w-0 flex-col gap-3 p-4 lg:col-span-4 lg:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="ds-mono text-ds-faint">
            {index ?? "--"} / {dayLabel ? dayLabel.toUpperCase() : "NO DAY"}
          </span>
          <span className="ds-num text-[15px] font-bold">{time ?? "--:--"}</span>
        </div>
        <h3 className="text-[26px] font-black leading-[0.95] tracking-[-0.04em] [overflow-wrap:anywhere] lg:text-[36px]">{heading}</h3>
        {item.caption ? (
          <p className="line-clamp-4 whitespace-pre-wrap text-[15px] leading-snug text-ds-muted">{item.caption}</p>
        ) : (
          <p className="ds-mono text-ds-faint">no caption yet</p>
        )}
        <div className="mt-auto flex flex-wrap gap-2">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          <Chip>
            <PlatformLogo platform={item.platform} size={14} />
            {PLATFORM_NAME[item.platform]}
          </Chip>
          {item.media.pillar ? <Chip>{item.media.pillar}</Chip> : null}
          {item.tiktokDraft ? <Chip>Inbox draft</Chip> : null}
        </div>
      </div>

      {hasFooter ? (
      <div className="col-span-4 flex flex-col gap-4 border-t border-ds-line p-4 lg:col-span-6 lg:p-6">
        {pastTime ? (
          <p className="flex">
            <Chip wrap tone="warn">
              {pastTime}
            </Chip>
          </p>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {warnings.map((w, i) => (
              <li key={i}>
                <WarningLine tone={w.severity === "block" ? "danger" : "warn"} label={w.severity === "block" ? "Blocked" : "Check"}>
                  {w.field ? `${w.field}: ` : ""}
                  {w.message}
                </WarningLine>
              </li>
            ))}
          </ul>
        ) : null}

        {stuck ? (
          <div className="flex flex-col gap-4">
            <Readout
              items={[
                { k: "Status", v: item.status === "failed" ? "failed · gave up" : "unknown · not retried" },
                { k: "Attempts", v: String(item.attempts ?? 0) },
                { k: "Scheduled", v: scheduledLabel(item.scheduledFor, timeZone) },
                { k: "Key", v: keyTailLabel(item.keyTail) },
              ]}
            />
            <div>
              <p className="ds-caps text-ds-faint">Last error</p>
              <p className="ds-mono mt-1 whitespace-pre-wrap border-l-2 border-ds-danger pl-3 text-ds-text [overflow-wrap:anywhere]">{item.lastError || "none recorded"}</p>
            </div>
            <ResetSheet
              batchId={item.batchId}
              itemId={item.id}
              platform={item.platform}
              status={item.status}
              attempts={item.attempts ?? 0}
              lastError={item.lastError ?? null}
              scheduled={scheduledLabel(item.scheduledFor, timeZone)}
              keyTail={item.keyTail ?? null}
              canReset={actions.reset}
              canRecord={actions.record}
              defaultOpen={openReset ? (actions.reset ? "reset" : "record") : undefined}
            />
            {actions.handoffNote ? (
              <p className="text-[15px] leading-snug text-ds-muted">
                Snapchat is assisted: use the{" "}
                <Link href="/handoff" className="inline-flex min-h-11 items-center font-bold text-ds-accent-fg underline underline-offset-4">
                  handoff page
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}

        {item.status === "published" && postUrl ? (
          <a href={postUrl} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "outline", block: true, arrow: true })}>
            View the post
            <Icon name="arrowUpRight" size={16} />
          </a>
        ) : null}
        {handoff ? <p className="ds-mono text-ds-faint">{handoff}</p> : null}

        <ItemForm
          batchId={item.batchId}
          itemId={item.id}
          isYoutube={item.platform === "youtube"}
          caption={item.caption}
          title={item.title}
          scheduledLocal={toDatetimeLocal(item.scheduledFor, timeZone)}
          editable={item.editable}
          action={editAction}
          primary={primary}
          danger={danger}
        />
      </div>
      ) : null}
    </li>
  );
}
