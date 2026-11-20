import { Button, ButtonLink, Icon, PlatformLogo, cx } from "../ui/index.js";
import { kindLabel, type AlertView } from "../../lib/alerts/queries.js";
import { describeAlert, isUrgent, sourceGlyph, type AlertAction } from "../../lib/alerts/view.js";
import { acknowledgeAction } from "../../app/alerts/actions.js";
import { approveItemsAction, rescheduleMissedAction } from "../../app/calendar/actions.js";
import { approveAndSendAction } from "../../app/inbox/actions.js";

/** One action as a form button / link. Server actions only; nothing posts without the tap. */
function ActionButton({ action, primary }: { action: AlertAction; primary: boolean }) {
  const variant = primary ? "solid" : "outline";
  switch (action.kind) {
    case "link":
      return (
        <ButtonLink href={action.href} variant={primary ? "solid" : "ghost"} size="sm">
          {action.label}
        </ButtonLink>
      );
    case "approve-reply":
      return (
        <form action={approveAndSendAction.bind(null, action.commentId)}>
          <Button type="submit" variant={variant} size="sm">
            {action.label}
          </Button>
        </form>
      );
    case "approve-item":
      return (
        <form action={approveItemsAction}>
          <input type="hidden" name="item" value={action.item} />
          <Button type="submit" variant={variant} size="sm">
            {action.label}
          </Button>
        </form>
      );
    case "reschedule":
      return (
        <form action={rescheduleMissedAction}>
          <input type="hidden" name="itemId" value={action.itemId} />
          <input type="hidden" name="returnTo" value={action.returnTo} />
          <Button type="submit" variant={variant} size="sm">
            {action.label}
          </Button>
        </form>
      );
  }
}

/**
 * One alert as a list row: a coloured edge for urgency (no "Urgent" word), a plain-sentence title, the
 * detail (comment + draft, due time, why), then the actions with Acknowledge as the secondary button.
 * `proposedAt` = the slot previewRescheduleMissed proposed (missed-slot only).
 */
export function AlertRow({ alert, when, ackWhen, timeZone = "UTC", proposedAt = null, now = new Date() }: { alert: AlertView; index?: number; when: string; ackWhen?: string; timeZone?: string; proposedAt?: string | null; now?: Date }) {
  const open = !alert.acknowledgedAt;
  const urgent = isUrgent(alert.kind) && open;
  const src = sourceGlyph(alert.source);
  const headingId = `alert-${alert.id}`;
  const d = describeAlert(alert, now, timeZone, { proposedAt });
  const actions = open ? d.actions : d.actions.filter((a) => a.kind === "link");
  return (
    <li
      aria-labelledby={headingId}
      className={cx("flex flex-col gap-2 border-l-4 py-4 pl-3 first:pt-0 last:pb-0", urgent ? "border-ds-danger" : open ? "border-ds-warn" : "border-ds-line")}
    >
      <h3 id={headingId} className="text-[15px] font-semibold leading-snug text-ds-text">
        {d.title}
      </h3>
      {d.body ? <p className="whitespace-pre-wrap break-words text-[15px] leading-snug text-ds-text">{d.body}</p> : null}
      {d.quote ? (
        <div className="flex flex-col gap-2 rounded-ds-sm bg-ds-raised p-3 text-[14px] leading-snug">
          <p className="break-words">
            <span className="block text-[12px] font-semibold text-ds-muted">Comment</span>
            {d.quote.comment}
          </p>
          <p className="break-words">
            <span className="block text-[12px] font-semibold text-ds-muted">Your reply</span>
            {d.quote.reply}
          </p>
        </div>
      ) : null}
      {d.why ? <p className="text-[13px] text-ds-muted">{d.why}</p> : null}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ds-muted">
        <span className="font-semibold">{kindLabel(alert.kind)}</span>
        {alert.source !== "all" ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5">
              {src.platform ? <PlatformLogo platform={src.platform} size={14} className="text-ds-text" /> : <Icon name="settings" size={14} />}
              {src.label}
            </span>
          </>
        ) : null}
        <span aria-hidden="true">·</span>
        <span className="ds-num">{when}</span>
        {ackWhen ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="ds-num">acknowledged {ackWhen}</span>
          </>
        ) : null}
      </p>
      {open || actions.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {actions.map((a, i) => (
            <ActionButton key={`${a.kind}-${a.label}`} action={a} primary={i === 0 && open && a.kind !== "link"} />
          ))}
          {open ? (
            <form action={acknowledgeAction}>
              <input type="hidden" name="id" value={alert.id} />
              <Button type="submit" variant="outline" size="sm" aria-label={`Acknowledge: ${d.title}`}>
                Acknowledge
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
