// Pure view logic for the /alerts page (app/alerts). No DB, no React. Tested in __tests__/view.test.ts.
// Labels come from queries.ts (read only); this module only arranges them.
import { KIND_ORDER, kindLabel, sourceLabel, type AlertState } from "./queries.js";
import { PUSH_KINDS_DEFAULT, type AlertKind } from "@autopilot/core";

type Line = { text: string; style?: "solid" | "stroke" | "serif" };
type Platform = "instagram" | "youtube" | "tiktok" | "snapchat";
type Counts = Partial<Record<AlertKind, number>>;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Act soon" kinds (the default push set); the rest are informational. */
const URGENT: ReadonlySet<AlertKind> = new Set(PUSH_KINDS_DEFAULT);
export const isUrgent = (kind: AlertKind) => URGENT.has(kind);

/** /alerts, /alerts?kind=…, /alerts?state=acknowledged&kind=… */
export function alertsHref(state: AlertState, kind?: AlertKind): string {
  const q = new URLSearchParams();
  if (state === "acknowledged") q.set("state", state);
  if (kind) q.set("kind", kind);
  const s = q.toString();
  return s ? `/alerts?${s}` : "/alerts";
}

export const total = (counts: Counts) => Object.values(counts).reduce((a: number, n) => a + (n ?? 0), 0);

/** Open alerts split into urgent (pushed) and informational. */
export function splitUrgent(counts: Counts): { urgent: number; info: number } {
  let urgent = 0;
  let info = 0;
  for (const [k, n] of Object.entries(counts) as Array<[AlertKind, number | undefined]>) {
    if (isUrgent(k)) urgent += n ?? 0;
    else info += n ?? 0;
  }
  return { urgent, info };
}

/** Hero display: "Alerts / open now / 3". */
export function heroLines(open: number): Line[] {
  return [
    { text: "Alerts", style: "stroke" },
    { text: "open now", style: "serif" },
    { text: String(Math.max(0, open)), style: "solid" },
  ];
}

/** Status dot above the hero. Danger when an urgent alert is open, warn for info-only, blue when clear. */
export function pulseFor(counts: Counts): { label: string; tone: "accent" | "warn" | "danger" } {
  const { urgent, info } = splitUrgent(counts);
  if (urgent > 0) return { label: `${urgent} need${urgent === 1 ? "s" : ""} you`, tone: "danger" };
  if (info > 0) return { label: `${plural(info, "notice")} open`, tone: "warn" };
  return { label: "All clear", tone: "accent" };
}

/** Open / Acknowledged URL tabs. Open carries the open count; the tab we're on stays in the URL. */
export function stateTabs(current: AlertState, open: number) {
  return [
    { href: alertsHref("open"), label: "Open", count: open, active: current === "open" },
    { href: alertsHref("acknowledged"), label: "Acknowledged", active: current === "acknowledged" },
  ];
}

/** "All" plus one tab per kind present in this tab (or the active one). Tapping the active kind clears it. */
export function kindTabs(state: AlertState, current: AlertKind | undefined, counts: Counts) {
  const kinds = KIND_ORDER.filter((k) => (counts[k] ?? 0) > 0 || k === current);
  return [
    { href: alertsHref(state), label: "All", count: total(counts), active: !current },
    ...kinds.map((k) => ({ href: alertsHref(state, k === current ? undefined : k), label: kindLabel(k), count: counts[k] ?? 0, active: k === current })),
  ];
}

/** Section head for the list being shown. */
export function listHead(state: AlertState, shown: number, kind: AlertKind | undefined, ackDays: number) {
  const filter = kind ? ` · ${kindLabel(kind)}` : "";
  return state === "open"
    ? { index: "01", title: "Open", serif: "now", meta: `${shown} shown${filter} · newest first` }
    : { index: "01", title: "Acknowledged", serif: "recently", meta: `Last ${ackDays} days${filter} · kept, never deleted` };
}

/** The source as a platform glyph when it is one of the four, otherwise just the label. */
export function sourceGlyph(source: string): { platform: Platform | null; label: string } {
  const platform = (["instagram", "youtube", "tiktok", "snapchat"] as const).find((p) => p === source) ?? null;
  return { platform, label: sourceLabel(source) };
}

/** Message as text, capped (writers sanitise; this only bounds the length on screen). */
export const shownMessage = (message: string) => (message.length > 1000 ? `${message.slice(0, 1000)}…` : message);

/** Copy for the Acknowledge-all sheet. */
export function ackAllCopy(n: number, kind: AlertKind | undefined) {
  return {
    trigger: `Acknowledge all ${n}`,
    title: `Acknowledge ${plural(n, "alert")}?`,
    confirm: `Confirm: acknowledge ${n}`,
    scope: kind ? `All open “${kindLabel(kind)}” alerts on this page` : "All open alerts on this page",
  };
}

/** Push block status dot (client state → label + tone). */
export function pushPulse(support: string | null, subscribed: boolean | null): { label: string; tone: "accent" | "warn" | "muted" } {
  if (support === null || (support === "ok" && subscribed === null)) return { label: "Checking", tone: "muted" };
  if (support !== "ok") return { label: support === "no-key" ? "Not set up" : support === "denied" ? "Blocked" : "Unavailable", tone: "warn" };
  return subscribed ? { label: "On for this device", tone: "accent" } : { label: "Off on this device", tone: "muted" };
}
