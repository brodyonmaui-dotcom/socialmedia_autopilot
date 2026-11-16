import { cx } from "./cx.js";

export type PulseTone = "accent" | "warn" | "danger" | "muted";

const TONE: Record<PulseTone, string> = {
  accent: "bg-ds-accent",
  warn: "bg-ds-warn",
  danger: "bg-ds-danger",
  muted: "bg-ds-muted",
};

/**
 * Status dot + label. v3: the dot is static (hard rule 2: nothing pulses). The label carries the meaning.
 * @deprecated name; prefer a Badge or a DataRow meta line in new screens.
 */
export function StatusPulse({ label, tone = "accent", className }: { label: string; tone?: PulseTone; className?: string }) {
  return (
    <span className={cx("ds-label inline-flex items-center gap-2", className)}>
      <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-full", TONE[tone])} />
      {label}
    </span>
  );
}
