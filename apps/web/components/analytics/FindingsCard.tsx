import type { Finding } from "@autopilot/analytics";
import { ButtonLink, Card, EmptyState, FOCUS, Icon, PlatformLogo, cx } from "../ui/index.js";
import { PLATFORM_LABEL, splitFindings, type FindingView } from "../../lib/analytics/present.js";

function Sample({ f }: { f: FindingView }) {
  return <span className="ds-num text-[13px] text-ds-muted">{f.sample}</span>;
}

/**
 * "What worked": the strongest real difference as the page's one italic pull-quote, the other findings as
 * one sentence each with "n = …", and the thin groups collapsed under "Not enough posts yet (N)".
 * Findings compare median views; they're correlations, and the footnote says so.
 */
export function FindingsCard({
  findings,
  days,
  quote = true,
  showPlatform = true,
  className,
}: {
  findings: Finding[];
  days: number;
  /** Render the lead finding as the italic pull-quote (once per screen). */
  quote?: boolean;
  showPlatform?: boolean;
  className?: string;
}) {
  const { lead, ok, insufficient } = splitFindings(findings);
  const rows = lead && !quote ? [lead, ...ok] : ok;
  const empty = !lead && ok.length === 0;
  return (
    <Card title="What worked" titleId="what-worked" subtitle={`Median views, last ${days} days`} className={className}>
      {lead && quote ? (
        <figure className="mb-4 border-b border-ds-line pb-4">
          <blockquote className="ds-quote text-[22px] text-ds-text lg:text-[26px]">{lead.sentence}</blockquote>
          <figcaption className="mt-2">
            <Sample f={lead} />
          </figcaption>
        </figure>
      ) : null}
      {empty ? (
        <EmptyState
          icon="analytics"
          title="Too early to tell"
          body={`Each comparison needs at least 5 posts on both sides. Keep posting and this fills in.`}
          action={
            <ButtonLink href="/calendar" variant="outline" size="sm">
              Open the calendar
            </ButtonLink>
          }
          className="py-4"
        />
      ) : rows.length ? (
        <ul aria-label="Findings" className="flex flex-col divide-y divide-ds-line">
          {rows.map((f) => (
            <li key={f.key} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              {showPlatform ? <PlatformLogo platform={f.platform} size={18} title={PLATFORM_LABEL[f.platform]} className="mt-0.5 shrink-0 text-ds-text" /> : null}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[15px] leading-snug text-ds-text">{f.sentence}</span>
                <Sample f={f} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {insufficient.length ? (
        <details className="group mt-3 border-t border-ds-line pt-1">
          <summary className={cx("-mx-1.5 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-ds-sm px-1.5 text-[14px] font-semibold text-ds-text hover:bg-ds-raised [&::-webkit-details-marker]:hidden", FOCUS)}>
            <Icon name="chevronRight" size={16} className="text-ds-muted transition-transform duration-[var(--ds-dur-fast)] group-open:rotate-90" />
            Not enough posts yet ({insufficient.length})
          </summary>
          <ul className="flex flex-col gap-2 pb-1 pt-2">
            {insufficient.map((f) => (
              <li key={f.key} className="flex flex-col gap-0.5 pl-6">
                <span className="text-[14px] leading-snug text-ds-muted">{f.sentence}</span>
                <Sample f={f} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="mt-auto pt-4 text-[13px] text-ds-muted">Patterns, not proof: other things change between posts too.</p>
    </Card>
  );
}
