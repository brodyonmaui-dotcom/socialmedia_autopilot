import { Button, ButtonLink, Icon, PlatformLogo, cx } from "../../../components/ui/index.js";
import { kindLabel, type AlertView } from "../../../lib/alerts/queries.js";
import { isUrgent, shownMessage, sourceGlyph } from "../../../lib/alerts/view.js";
import { acknowledgeAction } from "../actions.js";

/**
 * One alert as a list row inside the Notifications card: icon, kind label, the message (plain text, as
 * stored: writers sanitise at write time), source + age, then Acknowledge (open alerts) and "Open in calendar".
 */
export function AlertCard({ alert, when, ackWhen }: { alert: AlertView; index?: number; when: string; ackWhen?: string }) {
  const open = !alert.acknowledgedAt;
  const urgent = isUrgent(alert.kind) && open;
  const src = sourceGlyph(alert.source);
  const headingId = `alert-${alert.id}`;
  return (
    <li aria-labelledby={headingId} className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-3 gap-y-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[36px_minmax(0,1fr)_auto]">
      <span
        aria-hidden="true"
        className={cx(
          "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-ds-raised",
          urgent ? "text-ds-danger" : open ? "text-ds-warn" : "text-ds-muted",
        )}
      >
        <Icon name={open ? "alert" : "check"} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 id={headingId} className="text-[13px] font-semibold text-ds-muted">
          {kindLabel(alert.kind)}
          {urgent ? <span className="text-ds-danger"> · Urgent</span> : null}
        </h3>
        <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-snug text-ds-text">{shownMessage(alert.message)}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ds-muted">
          <span className="inline-flex items-center gap-1.5">
            {src.platform ? <PlatformLogo platform={src.platform} size={14} className="text-ds-text" /> : <Icon name="settings" size={14} />}
            {src.label}
          </span>
          <span aria-hidden="true">·</span>
          <span className="ds-num">{when}</span>
          {ackWhen ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="ds-num">acknowledged {ackWhen}</span>
            </>
          ) : null}
        </p>
      </div>
      {open || alert.batchId ? (
        <div className="col-start-2 flex shrink-0 gap-2 sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-stretch">
          {open ? (
            <form action={acknowledgeAction}>
              <input type="hidden" name="id" value={alert.id} />
              <Button type="submit" variant="outline" size="sm" aria-label={`Acknowledge: ${kindLabel(alert.kind)}`}>
                Acknowledge
              </Button>
            </form>
          ) : null}
          {alert.batchId ? (
            <ButtonLink href={`/batches/${alert.batchId}`} variant="ghost" size="sm">
              Open in calendar
            </ButtonLink>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
