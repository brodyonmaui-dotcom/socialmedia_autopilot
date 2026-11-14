import { Badge, Button, ButtonLink, CONTAINER, Icon, PlatformLogo, cx } from "../../../components/ui/index.js";
import { kindLabel, type AlertView } from "../../../lib/alerts/queries.js";
import { isUrgent, shownMessage, sourceGlyph } from "../../../lib/alerts/view.js";
import { acknowledgeAction } from "../actions.js";

/**
 * One alert as a bordered grid band: kind (3 cols) | message + source + age (6) | actions (3).
 * The message is shown as stored (sanitised at write time), as plain text.
 */
export function AlertCard({ alert, index, when, ackWhen }: { alert: AlertView; index: number; when: string; ackWhen?: string }) {
  const open = !alert.acknowledgedAt;
  const urgent = isUrgent(alert.kind) && open;
  const src = sourceGlyph(alert.source);
  const headingId = `alert-${alert.id}`;
  return (
    <li className="border-b border-ds-line">
      <div className={cx(CONTAINER, "grid grid-cols-4 gap-y-4 py-6 lg:grid-cols-12 lg:py-8")}>
        {/* Kind */}
        <div className="col-span-4 flex min-w-0 items-center justify-between gap-3 lg:col-span-3 lg:flex-col lg:items-start lg:justify-start lg:pr-10">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="ds-mono text-ds-faint">
              {String(index).padStart(2, "0")}
            </span>
            <h3 id={headingId} className="ds-caps flex min-w-0 items-center gap-2 text-ds-text">
              <Icon name={open ? "alert" : "check"} size={16} strokeWidth={2} className={cx("shrink-0", urgent ? "text-ds-danger" : open ? "text-ds-warn" : "text-ds-muted")} />
              {kindLabel(alert.kind)}
            </h3>
          </div>
          {urgent ? <Badge tone="danger">Urgent</Badge> : !open ? <Badge tone="neutral">Acknowledged</Badge> : <Badge tone="warn">Notice</Badge>}
        </div>

        {/* Message */}
        <div className="col-span-4 flex min-w-0 flex-col gap-3 lg:col-span-6 lg:border-l lg:border-ds-line lg:px-10">
          <p className="whitespace-pre-wrap break-words text-[18px] font-bold leading-snug tracking-[-0.01em] text-ds-text lg:text-[20px]">{shownMessage(alert.message)}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ds-muted">
            <span className="ds-caps inline-flex items-center gap-2 text-ds-text">
              {src.platform ? <PlatformLogo platform={src.platform} size={16} /> : <Icon name="settings" size={16} />}
              {src.label}
            </span>
            <span aria-hidden="true">·</span>
            <span className="ds-mono">{when}</span>
            {ackWhen ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="ds-mono">ack {ackWhen}</span>
              </>
            ) : null}
          </p>
        </div>

        {/* Actions */}
        {open || alert.batchId ? (
          <div className="col-span-4 grid grid-cols-2 content-start gap-2 lg:col-span-3 lg:grid-cols-1 lg:border-l lg:border-ds-line lg:pl-10">
            {open ? (
              <form action={acknowledgeAction} className={cx(alert.batchId ? "col-span-1" : "col-span-2", "lg:col-span-1")}>
                <input type="hidden" name="id" value={alert.id} />
                <Button type="submit" variant="outline" size="sm" block className="px-3" aria-label={`Acknowledge: ${kindLabel(alert.kind)}`}>
                  Acknowledge
                </Button>
              </form>
            ) : null}
            {alert.batchId ? (
              <ButtonLink href={`/batches/${alert.batchId}`} variant="ghost" size="sm" block arrow className={cx("px-3", open ? "col-span-1" : "col-span-2", "lg:col-span-1")}>
                Open batch
              </ButtonLink>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
