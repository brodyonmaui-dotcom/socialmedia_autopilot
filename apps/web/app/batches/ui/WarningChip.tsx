import type { Platform } from "@autopilot/core";
import type { ItemStatus, Warning } from "../../../lib/batches/types.js";

// Shared look for the batch screens. No hooks, no server-only imports: safe in server and client components.
export const BTN = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-base font-medium disabled:opacity-40";
export const BTN_PRIMARY = `${BTN} bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900`;
export const BTN_GHOST = `${BTN} border border-neutral-300 dark:border-neutral-700`;
export const BTN_DANGER = `${BTN} border border-red-300 text-red-700 dark:border-red-800 dark:text-red-300`;
export const INPUT = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base dark:border-neutral-700 dark:bg-neutral-900";

export function WarningChip({ w }: { w: Warning }) {
  const tone =
    w.severity === "block"
      ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
      : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200";
  return (
    <li title={w.message} className={`rounded-md border px-2 py-1 text-sm ${tone}`}>
      <span className="font-medium">{w.severity === "block" ? "Blocked" : "Check"}</span>
      {w.field ? <span className="opacity-70"> · {w.field}</span> : null}: {w.message}
    </li>
  );
}

const STATUS_TONE: Record<ItemStatus, string> = {
  draft: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  queued: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  publishing: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  published: "bg-emerald-600 text-white",
  failed: "bg-red-600 text-white",
  unknown: "bg-amber-500 text-white",
  rejected: "bg-neutral-200 text-neutral-500 line-through dark:bg-neutral-800",
};

export function StatusPill({ status }: { status: ItemStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_TONE[status]}`}>{status}</span>;
}

const PLATFORM_LABEL: Record<Platform, string> = { instagram: "IG", youtube: "YT", tiktok: "TT", snapchat: "SC" };
const PLATFORM_TONE: Record<Platform, string> = {
  instagram: "bg-pink-600 text-white",
  youtube: "bg-red-600 text-white",
  tiktok: "bg-neutral-900 text-white dark:bg-neutral-700",
  snapchat: "bg-yellow-400 text-neutral-900",
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <span title={platform} className={`inline-flex h-7 min-w-9 items-center justify-center rounded-md px-1.5 text-sm font-bold ${PLATFORM_TONE[platform]}`}>
      {PLATFORM_LABEL[platform]}
    </span>
  );
}

export function Banner({ kind, text }: { kind: "error" | "note"; text?: string }) {
  if (!text) return null;
  const tone =
    kind === "error"
      ? "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      : "border-green-400 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200";
  return (
    <p role={kind === "error" ? "alert" : "status"} className={`mt-3 rounded-lg border p-3 text-base ${tone}`}>
      {text}
    </p>
  );
}
