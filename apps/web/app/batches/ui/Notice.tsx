import { AlertCard, CONTAINER, Chip, Icon, cx } from "../../../components/ui/index.js";

/**
 * The ?error= / ?note= result of a batch action, as a band under the page title.
 * Errors use AlertCard (warn icon, announced); notes are a quiet accent line (no green).
 */
export function Notice({ error, note }: { error?: string | undefined; note?: string | undefined }) {
  if (!error && !note) return null;
  return (
    <div className="border-b border-ds-line">
      <div className={cx(CONTAINER, "flex flex-col gap-3 py-4")}>
        {error ? (
          <AlertCard tone="light" title="Couldn't do that" live>
            {error}
          </AlertCard>
        ) : null}
        {note ? (
          <p role="status" className="flex items-start gap-2 border border-ds-line bg-ds-card p-5 text-[15px] leading-snug text-ds-text">
            <Icon name="check" size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-ds-accent-fg" />
            <span>
              <span className="ds-caps mr-2 text-ds-accent-fg">Done</span>
              {note}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A warning that can run to two lines: a wrapping warn/danger Chip (alert icon) across the card width. */
export function WarningLine({ tone, label, children }: { tone: "warn" | "danger"; label?: string; children: React.ReactNode }) {
  return (
    <Chip wrap tone={tone} className="flex w-full">
      {label ? <span className="font-bold">{label}: </span> : null}
      {children}
    </Chip>
  );
}
