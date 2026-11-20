// Pure view logic for the /alerts page (app/alerts). No DB, no React. Tested in __tests__/view.test.ts.
// Labels come from queries.ts (read only); this module only arranges them.
import { KIND_ORDER, kindLabel, sourceLabel, type AlertState } from "./queries.js";
import { PUSH_KINDS_DEFAULT, localClock12, type AlertKind } from "@autopilot/core";
import { batchRedirect } from "../calendar/model.js";
import type { AlertView } from "./queries.js";

type Line = { text: string; style?: "solid" | "stroke" | "serif" };
type Platform = "instagram" | "youtube" | "tiktok" | "snapchat";
type Counts = Partial<Record<AlertKind, number>>;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Act soon" kinds (the default push set); the rest are informational. */
const URGENT: ReadonlySet<AlertKind> = new Set(PUSH_KINDS_DEFAULT);
export const isUrgent = (kind: AlertKind) => URGENT.has(kind);

/** "Open in calendar" for a batch-linked alert: the week view of its batch directly (not the old /batches/<id> hop); null when unlinked. */
export function alertCalendarHref(a: Pick<AlertView, "batchId" | "weekStart">): string | null {
  return a.batchId ? batchRedirect(a.weekStart) : null;
}

/** F14 report-ready: the Monday alert opens the last 7 days of analytics. */
export const REPORT_READY_HREF = "/analytics?days=7";

/**
 * The row's one link. report-ready → the 7-day analytics view; everything batch-linked (batch-ready points
 * at the first item it added, so it opens that week) → the calendar week; otherwise null.
 */
export function alertLink(a: Pick<AlertView, "kind" | "batchId" | "weekStart">): { href: string; label: string } | null {
  if (a.kind === "report-ready") return { href: REPORT_READY_HREF, label: "Open report" };
  const href = alertCalendarHref(a);
  return href ? { href, label: "Open in calendar" } : null;
}

/** /alerts, /alerts?kind=…, /alerts?state=acknowledged&kind=… */
export function alertsHref(state: AlertState, kind?: AlertKind): string {
  const q = new URLSearchParams();
  if (state === "acknowledged") q.set("state", state);
  if (kind) q.set("kind", kind);
  const s = q.toString();
  return s ? `/notifications?${s}` : "/notifications";
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

// ---- Plain-language description of one alert (the row renders this; pure, tested per kind) ----

export type AlertAction =
  | { kind: "link"; label: string; href: string }
  | { kind: "approve-reply"; label: string; commentId: string }
  | { kind: "approve-item"; label: string; item: string } // "batchId:itemId" (approveItemsAction)
  | { kind: "reschedule"; label: string; itemId: string; returnTo: string };

export interface AlertDescription {
  title: string;
  body?: string;
  quote?: { comment: string; reply: string };
  why?: string;
  actions: AlertAction[];
}

/** "Thu 8:00 AM" in the creator's zone (12-hour). */
export function dayClock12(date: Date | string, timeZone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(d);
  return `${day} ${localClock12(d, timeZone)}`;
}

const shortMessage = (m: string) => (m.length > 300 ? `${m.slice(0, 299)}…` : m);

/**
 * Title, optional body / quote / why, and the actions for one alert. Sentences, not labels: urgency is the
 * row's coloured edge, never a word. `extra.proposedAt` = the slot previewRescheduleMissed proposed for a missed-slot.
 */
export function describeAlert(a: AlertView, _now: Date, timeZone: string, extra: { proposedAt?: string | null } = {}): AlertDescription {
  const where = a.source === "all" ? "" : sourceLabel(a.source);
  const plat = a.platform ? sourceLabel(a.platform) : where;
  const post = plat ? `${plat} post` : "post";
  const cal = alertLink({ kind: "duplicate", batchId: a.batchId, weekStart: a.weekStart });
  const calendar: AlertAction[] = cal ? [{ kind: "link", label: cal.label, href: cal.href }] : [];
  const msg = shortMessage(a.message);

  switch (a.kind) {
    case "reply-ready": {
      if (!a.commentId) {
        const n = /\d+/.exec(a.message)?.[0];
        return {
          title: n ? `${n} ${n === "1" ? "reply is" : "replies are"} drafted and waiting` : "Replies are drafted and waiting",
          actions: [{ kind: "link", label: "Open Inbox", href: "/inbox" }],
        };
      }
      const cp = a.commentPlatform ? sourceLabel(a.commentPlatform) : where;
      return {
        title: cp ? `Reply drafted for a comment on ${cp}` : "Reply drafted for a comment",
        ...(a.commentText && a.draftReply ? { quote: { comment: a.commentText, reply: a.draftReply } } : a.commentText ? { body: a.commentText } : {}),
        actions: [
          { kind: "approve-reply", label: "Approve & send", commentId: a.commentId },
          { kind: "link", label: "Open in Inbox", href: `/inbox/item/${a.commentId}` },
        ],
      };
    }
    case "missed-slot": {
      const actions: AlertAction[] = [];
      if (a.batchItemId && extra.proposedAt) {
        actions.push({ kind: "reschedule", label: `Auto-schedule at nearest slot (${dayClock12(extra.proposedAt, timeZone)})`, itemId: a.batchItemId, returnTo: "/notifications" });
      }
      const due = a.scheduledFor ? `was due ${dayClock12(a.scheduledFor, timeZone)}` : "is past its time";
      return {
        title: `A ${post} missed its time`,
        body: a.itemTitle ? `${a.itemTitle} ${due}` : `The post ${due}`,
        why: "Held so late posts don't go out in a burst.",
        actions: [...actions, ...calendar],
      };
    }
    case "ready-for-approval":
      return {
        title: "New posts are ready for your approval",
        ...(a.itemTitle ? { body: a.itemTitle } : {}),
        actions: [
          ...(a.batchId && a.batchItemId ? [{ kind: "approve-item", label: "Approve", item: `${a.batchId}:${a.batchItemId}` } as AlertAction] : []),
          ...calendar,
        ],
      };
    case "final-failure":
      return { title: `A ${post} failed to send`, body: msg, why: "Retry it, or record it as published if it went out.", actions: calendar };
    case "unknown-outcome":
      return { title: `A ${post} may or may not have gone out`, body: msg, why: "Check the platform before retrying, so it can't post twice.", actions: calendar };
    case "cap-breach":
      return { title: `A ${post} was held at the daily limit`, body: msg, actions: calendar };
    case "duplicate":
      return { title: `A ${post} was already posted once`, body: msg, actions: calendar };
    case "token-health":
      return { title: `${where || "A"} connection needs attention`, body: msg, why: "Renew it: docs runbook token-renewal.", actions: [] };
    case "auth":
      return { title: "A sign-in problem was recorded", body: msg, actions: [{ kind: "link", label: "Open Settings", href: "/settings" }] };
    case "engagement-kill":
      return { title: "Auto-replies were stopped", body: msg, actions: [{ kind: "link", label: "Open Settings", href: "/settings" }] };
    case "engagement-mode":
      return { title: "Reply mode changed", body: msg, actions: [{ kind: "link", label: "Open Settings", href: "/settings" }] };
    case "engagement-failure":
      return { title: `A reply${where ? ` on ${where}` : ""} failed to send`, body: msg, actions: [{ kind: "link", label: "Open Inbox", href: "/inbox" }] };
    case "engagement-unknown":
      return { title: `A reply${where ? ` on ${where}` : ""} may or may not have gone out`, body: msg, actions: [{ kind: "link", label: "Open Inbox", href: "/inbox" }] };
    case "metrics-health":
      return { title: "Some numbers could not be fetched", body: msg, actions: [{ kind: "link", label: "Open Analytics", href: "/analytics" }] };
    case "config":
      return { title: "A setting needs fixing", body: msg, actions: [{ kind: "link", label: "Open Settings", href: "/settings" }] };
    case "settings-change":
      return { title: "A setting was changed", body: msg, actions: [{ kind: "link", label: "Open Settings", href: "/settings" }] };
    case "auto-scheduled":
      return { title: "An approved render was scheduled", body: msg, actions: calendar };
    case "batch-ready":
      return { title: "Next week's drafts are ready for captions", body: msg, actions: calendar };
    case "report-ready":
      return { title: "Last week's report is ready", actions: [{ kind: "link", label: "Open report", href: REPORT_READY_HREF }] };
  }
}

/** Header copy: "4 to handle: 2 reply ready, 1 missed post, 1 other" (largest kinds first, at most 3 named). */
export function handleSummary(counts: Counts): string {
  const n = total(counts);
  if (n === 0) return "Nothing needs you right now.";
  const parts = (Object.entries(counts) as Array<[AlertKind, number]>)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]));
  const named = parts.slice(0, 3).map(([k, c]) => `${c} ${kindLabel(k).toLowerCase()}`);
  const rest = parts.slice(3).reduce((a, [, c]) => a + c, 0);
  if (rest > 0) named.push(`${rest} other`);
  return `${n} to handle: ${named.join(", ")}`;
}
