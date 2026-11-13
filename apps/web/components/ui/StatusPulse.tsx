import { cx } from "./cx.js";

export type PulseTone = "accent" | "warn" | "danger" | "muted";

/** Dot colour + currentColor (the ds-pulse keyframe rings in currentColor). No green, by the creator's rule. */
const TONE: Record<PulseTone, string> = {
  accent: "bg-ds-accent text-ds-accent",
  warn: "bg-ds-warn text-ds-warn",
  danger: "bg-ds-danger text-ds-danger",
  muted: "bg-ds-muted text-ds-muted",
};

/** 6px status dot with a ring pulse + caps label. The label carries the meaning; the pulse is decoration. */
export function StatusPulse({ label, tone = "accent", className }: { label: string; tone?: PulseTone; className?: string }) {
  return (
    <span className={cx("ds-caps inline-flex items-center gap-2", className)}>
      <span aria-hidden="true" className={cx("size-1.5 shrink-0 rounded-full animate-ds-pulse", TONE[tone])} />
      {label}
    </span>
  );
}
