import type { ReactNode } from "react";
import { cx } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";

export type StatDelta = { text: string; tone?: "up" | "down" | "flat" };
export type StatTint = 1 | 2 | 3 | 4;

const TINT: Record<StatTint, string> = {
  1: "bg-ds-tint-1",
  2: "bg-ds-tint-2",
  3: "bg-ds-tint-3",
  4: "bg-ds-tint-4",
};

/**
 * KPI tile (v3): icon + label row, the number (Inter 700 tabular, 28 / 32 px), then one line: the delta
 * ("▲ 12% vs last week": accent when up, muted otherwise) or, when the value is unknown, the reason.
 * `value = null` shows "–" (never a fake 0). Optional soft tint. Stretches to its row height.
 * Legacy v2 props: `caption` = label, `tone` is ignored.
 */
export function StatTile({
  icon,
  label,
  caption,
  value,
  delta,
  note,
  tint,
  className,
}: {
  icon: IconName;
  label?: string;
  /** @deprecated v2 name for `label`. */
  caption?: string;
  value: string | number | null;
  delta?: StatDelta | null;
  /** Shown when there is no delta (e.g. why the value is "–"). */
  note?: ReactNode;
  tint?: StatTint;
  /** @deprecated v2 tone; v3 tiles are ink. */
  tone?: "accent" | "neutral" | "warn";
  className?: string;
}) {
  const shown = value == null || value === "" ? "–" : value;
  return (
    <div
      className={cx(
        "flex h-full min-w-0 flex-col gap-2 rounded-ds-lg border border-ds-line p-4 lg:p-5",
        tint ? cx(TINT[tint], "border-transparent") : "bg-ds-card",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-ds-muted">
        <Icon name={icon} size={18} className="shrink-0" />
        <span className="ds-label min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{label ?? caption}</span>
      </div>
      <div className="ds-num text-[28px] font-bold leading-none text-ds-text lg:text-[32px]">{shown}</div>
      {delta ? (
        <p className={cx("ds-num text-[13px] font-semibold", delta.tone === "up" ? "text-ds-accent-fg" : "text-ds-muted")}>{delta.text}</p>
      ) : note != null ? (
        <p className="text-[13px] leading-snug text-ds-muted">{note}</p>
      ) : null}
    </div>
  );
}

/** Two StatTiles side by side. */
export function StatPair({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("grid grid-cols-2 gap-3 lg:gap-4", className)}>{children}</div>;
}
