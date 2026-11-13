import Link from "next/link";
import type { AlertKind } from "@autopilot/core";
import { KIND_ORDER, kindLabel, type AlertState } from "../../../lib/alerts/queries.js";

export function alertsHref(state: AlertState, kind?: AlertKind): string {
  const q = new URLSearchParams();
  if (state === "acknowledged") q.set("state", state);
  if (kind) q.set("kind", kind);
  const s = q.toString();
  return s ? `/alerts?${s}` : "/alerts";
}

/** "All" plus one chip per kind present in this tab, each with its count. Tapping the active chip clears it. */
export function KindChips({ state, current, counts }: { state: AlertState; current?: AlertKind; counts: Partial<Record<AlertKind, number>> }) {
  const total = Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);
  const kinds = KIND_ORDER.filter((k) => (counts[k] ?? 0) > 0 || k === current);
  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-full px-3 text-[15px] ${active ? "bg-neutral-900 font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900" : "border border-neutral-300 dark:border-neutral-700"}`;
  return (
    <nav aria-label="Filter by kind" className="mt-3 flex flex-wrap gap-2">
      <Link href={alertsHref(state)} className={chip(!current)}>
        All {total}
      </Link>
      {kinds.map((k) => (
        <Link key={k} href={alertsHref(state, k === current ? undefined : k)} className={chip(k === current)}>
          {kindLabel(k)} {counts[k] ?? 0}
        </Link>
      ))}
    </nav>
  );
}
