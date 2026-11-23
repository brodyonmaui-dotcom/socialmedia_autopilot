import type { ActionStatus, Bucket, EngagementLimits, EngagementPlatform, EngagementSettings, Mode } from "@autopilot/engagement";
import type { InboxFilter, InboxKind, InboxListRow } from "./list.js";
import type { ReplyStatusLine } from "./status.js";
import type { InboxItem } from "./item.js";

/** Pure view logic for /inbox and /inbox/dms (labels, tones, counts). No I/O. */

type Line = { text: string; style: "solid" | "stroke" | "serif" };
type Tone = "neutral" | "accent" | "warn" | "danger";
export type CommentTab = "flagged" | "shadow" | "sent";
export type InboxCounts = { flagged: number; shadow: number; dmsOpen: number };

export const ENGAGEMENT_PLATFORMS: readonly EngagementPlatform[] = ["instagram", "youtube", "tiktok"];
export const PLATFORM_NAME: Record<EngagementPlatform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok" };

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const two = (n: number) => String(Math.max(0, n)).padStart(2, "0");

/** What needs the creator: unhandled flagged comments + DM threads still inside the 24 h window. */
export function needsYou(c: InboxCounts): number {
  return Math.max(0, c.flagged) + Math.max(0, c.dmsOpen);
}

export function heroLines(c: InboxCounts): Line[] {
  return [
    { text: "Inbox", style: "stroke" },
    { text: "needs you", style: "serif" },
    { text: two(needsYou(c)), style: "solid" },
  ];
}

/** Top-level Comments / DMs tabs (URL tabs; the comment sub-tab keeps its ?tab= param). */
export function primaryTabs(onDms: boolean, c: InboxCounts) {
  return [
    { href: "/inbox", label: "Comments", count: c.flagged, active: !onDms },
    { href: "/inbox/dms", label: "DMs", count: c.dmsOpen, active: onDms },
  ];
}

export function commentTabs(current: CommentTab, c: InboxCounts) {
  return [
    { href: "/inbox", label: "Flagged", count: c.flagged, active: current === "flagged" },
    { href: "/inbox?tab=shadow", label: "Shadow", count: c.shadow, active: current === "shadow" },
    { href: "/inbox?tab=sent", label: "Sent", active: current === "sent" },
  ];
}

const BUCKET: Record<Bucket, { label: string; tone: Tone }> = {
  flag: { label: "Flag", tone: "warn" },
  hide_flag: { label: "Hide + flag", tone: "danger" },
  negative: { label: "Negative", tone: "warn" },
  simple_positive: { label: "Positive", tone: "neutral" },
  spam_promo: { label: "Promo · ignored", tone: "neutral" },
};

/** Triage label as a Chip (no green: positive is neutral; warn/danger carry the alert icon). */
export function bucketChip(bucket: string | null | undefined): { label: string; tone: Tone } | null {
  if (!bucket) return null;
  return BUCKET[bucket as Bucket] ?? { label: bucket.replace(/_/g, " "), tone: "neutral" };
}

const STATUS: Partial<Record<ActionStatus, { label: string; tone: "neutral" | "accent" | "warn" | "danger" }>> = {
  sent: { label: "Sent", tone: "accent" },
  sending: { label: "Sending", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
  unknown: { label: "Unknown", tone: "warn" },
  shadow: { label: "Shadow", tone: "neutral" },
  planned: { label: "Planned", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function actionBadge(status: string | undefined): { label: string; tone: "neutral" | "accent" | "warn" | "danger" } | null {
  if (!status) return null;
  return STATUS[status as ActionStatus] ?? { label: status, tone: "neutral" };
}

/** Label over the reply well. */
export function replyLabel(tab: CommentTab): string {
  return tab === "shadow" ? "Would reply" : tab === "sent" ? "Reply" : "Draft reply";
}

export function emptyCopy(tab: CommentTab): { title: string; body: string } {
  if (tab === "shadow") return { title: "No shadow replies", body: "In shadow mode the worker stores what it would have said here. Nothing is sent." };
  if (tab === "sent") return { title: "Nothing sent yet", body: "Replies and hides the worker sent show up here, newest first." };
  return { title: "Nothing flagged", body: "Comments that need you show up here." };
}

/** Overall auto-reply state for the hero pulse. Killed wins; then any live platform; else shadow/off. */
export function enginePulse(s: Pick<EngagementSettings, "killed" | "mode">): { label: string; tone: "accent" | "danger" | "muted" } {
  if (s.killed) return { label: "Auto-replies killed", tone: "danger" };
  const live = ENGAGEMENT_PLATFORMS.filter((p) => s.mode[p] === "live");
  if (live.length > 0) return { label: `Live · ${live.map((p) => PLATFORM_NAME[p]).join(", ")}`, tone: "accent" };
  if (ENGAGEMENT_PLATFORMS.some((p) => s.mode[p] === "shadow")) return { label: "Shadow · nothing sent", tone: "muted" };
  return { label: "Auto-replies off", tone: "muted" };
}

/** Per-platform mode pulse: live is blue (never green); shadow/off muted. Killed overrides live. */
export function modePulse(mode: Mode, killed: boolean): { label: string; tone: "accent" | "danger" | "muted" } {
  if (mode === "live") return killed ? { label: "Live · held", tone: "danger" } : { label: "Live", tone: "accent" };
  return { label: mode === "shadow" ? "Shadow" : "Off", tone: "muted" };
}

export type SentLike = { platform: EngagementPlatform; actionStatus?: string | undefined; sentAt?: string | null | undefined };

/**
 * Sends in the last 24 h (sent + sending, like the worker's countSent), per platform and overall.
 * `rows` is the Sent tab list (newest first, capped at 100, which is above the 80/day global limit).
 */
export function sentLast24h(rows: readonly SentLike[], now: Date): { all: number } & Record<EngagementPlatform, number> {
  const since = now.getTime() - 24 * 3_600_000;
  const out = { all: 0, instagram: 0, youtube: 0, tiktok: 0 };
  for (const r of rows) {
    if (r.actionStatus !== "sent" && r.actionStatus !== "sending") continue;
    if (r.actionStatus === "sent") {
      const t = r.sentAt ? Date.parse(r.sentAt) : NaN;
      if (!Number.isFinite(t) || t < since) continue;
    }
    out.all++;
    if (r.platform in out) out[r.platform]++;
  }
  return out;
}

/** Limit readouts: "used/limit" plus what's left, overall and per platform, then the fixed caps. */
export function limitReadout(limits: EngagementLimits, used: ReturnType<typeof sentLast24h>, minDelayMin: number) {
  const left = (u: number, max: number) => Math.max(0, max - u);
  return [
    { k: "All · 24 h", v: `${used.all}/${limits.globalPerDay} · ${left(used.all, limits.globalPerDay)} left` },
    ...ENGAGEMENT_PLATFORMS.map((p) => ({ k: `${PLATFORM_NAME[p]} · 24 h`, v: `${used[p]}/${limits.perPlatformPerDay} · ${left(used[p], limits.perPlatformPerDay)} left` })),
    { k: "Per hour", v: `${limits.perPlatformPerHour} / platform` },
    { k: "Per person", v: `1 / ${limits.perPersonDays} days` },
    { k: "Veto window", v: `${minDelayMin} min` },
  ];
}

/** Copy for the kill-switch sheet. `killed` is the current state; the sheet proposes the opposite. */
export function killSheet(killed: boolean): { title: string; points: string[]; confirm: string } {
  if (!killed) {
    return {
      title: "Kill auto-replies?",
      points: [
        "Stops every auto-reply and hide on all platforms at once, including manual sends from this inbox.",
        "Planned replies are held, not deleted. They send after you turn the switch off again.",
        "Writes an engagement-kill alert. Shadow rows keep being stored.",
      ],
      confirm: "Kill auto-replies",
    };
  }
  return {
    title: "Turn auto-replies back on?",
    points: [
      "Each platform goes back to its own mode: shadow stores only, live sends.",
      "Replies held while killed send on the next worker tick. Delete stale ones first.",
      "For a platform block, wait 24–48 h in shadow before resuming. ENGAGEMENT_KILL in the server env still wins.",
    ],
    confirm: "Resume",
  };
}

/** Resume needs the word typed (the server checks it again). */
export const resumeOk = (word: string) => word.trim().toLowerCase() === "resume";

/** DM reply-window tone for the countdown text. */
export function dmWindowTone(w: { open: boolean; msLeft: number }): "accent" | "warn" | "muted" {
  if (!w.open || w.msLeft <= 0) return "muted";
  return w.msLeft < 3 * 3_600_000 ? "warn" : "accent";
}

/** The last three messages of a thread, labelled for the transcript. */
export function lastMessages<M extends { dir: "in" | "out" }>(messages: readonly M[], n = 3): Array<M & { who: "Them" | "You" }> {
  return messages.slice(-n).map((m) => ({ ...m, who: m.dir === "in" ? "Them" : "You" }));
}

export const handleLabel = (h: string | null | undefined, fallback = "unknown author") => (h ? `@${h}` : fallback);

// ---- v3 inbox (run 4): filters, plain-word reasons, card plan. Pure. ----

export const FILTER_LABEL: Record<InboxFilter, string> = { "needs-you": "Needs you", drafted: "Drafted", sent: "Sent", ignored: "Ignored" };
const FILTER_IDS: readonly InboxFilter[] = ["needs-you", "drafted", "sent", "ignored"];
/** The old ?tab= values the server actions still redirect to (actions.ts pathFrom). */
const LEGACY_TAB: Record<string, InboxFilter> = { flagged: "needs-you", shadow: "drafted", sent: "sent" };

export function parseFilter(sp: { filter?: string | undefined; tab?: string | undefined }): InboxFilter {
  if (sp.filter && (FILTER_IDS as readonly string[]).includes(sp.filter)) return sp.filter as InboxFilter;
  return (sp.tab && LEGACY_TAB[sp.tab]) || "needs-you";
}

export function inboxHref(kind: InboxKind, filter: InboxFilter, cursor?: string | null): string {
  const q = new URLSearchParams();
  if (filter !== "needs-you") q.set("filter", filter);
  if (cursor) q.set("cursor", cursor);
  const s = q.toString();
  return `${kind === "dms" ? "/inbox/dms" : "/inbox"}${s ? `?${s}` : ""}`;
}

const LEGACY_TAB_PATH: Record<string, string> = { shadow: "/inbox?tab=shadow", sent: "/inbox?tab=sent", dms: "/inbox/dms" };

/**
 * Where an inbox action redirects back to, from the form's hidden fields: "filter" (a filter id; "tab" = "dms"
 * says the DMs list) wins, else the legacy "tab" value, else the list for `kind` (Needs you). Unknown values
 * are ignored. Pure: reads the two fields only.
 */
export function pathFrom(fd: Pick<FormData, "get"> | undefined, kind: InboxKind = "comments"): string {
  const get = (k: string) => {
    const v = fd?.get(k);
    return typeof v === "string" ? v : "";
  };
  const tab = get("tab");
  const filter = get("filter");
  const k: InboxKind = tab === "dms" ? "dms" : kind;
  if ((FILTER_IDS as readonly string[]).includes(filter)) return inboxHref(k, filter as InboxFilter);
  return LEGACY_TAB_PATH[tab] ?? inboxHref(k, "needs-you");
}

/** Hidden "tab" form field so an action returns to (roughly) the list it came from (the "filter" field is exact). */
export function returnTab(kind: InboxKind, filter: InboxFilter): string {
  if (kind === "dms") return "dms";
  return filter === "drafted" ? "shadow" : filter === "sent" ? "sent" : "flagged";
}

export function filterOptions(kind: InboxKind, counts: Record<InboxFilter, number>, current: InboxFilter) {
  return FILTER_IDS.map((f) => ({ label: `${FILTER_LABEL[f]} · ${counts[f] ?? 0}`, href: inboxHref(kind, f), current: f === current }));
}

export function kindTabs(kind: InboxKind, filter: InboxFilter, commentsNeed: number, dmsNeed: number) {
  return [
    { href: inboxHref("comments", filter), label: "Comments", count: commentsNeed, active: kind === "comments" },
    { href: inboxHref("dms", filter), label: "DMs", count: dmsNeed, active: kind === "dms" },
  ];
}

const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The one status line under the Inbox title (details and controls live in Settings). */
export function replyStatusSentence(lines: readonly Pick<ReplyStatusLine, "platform" | "label">[]): string {
  const on = (l: string) => lines.filter((x) => x.label === l).map((x) => PLATFORM_NAME[x.platform]);
  if (lines.some((x) => x.label === "held (killed)")) return "Replies are paused for every platform";
  const auto = on("auto");
  if (auto.length) return `Auto-reply is on for ${andList(auto)}`;
  const drafts = on("drafts only");
  if (drafts.length === lines.length) return "Replies are drafts only";
  if (drafts.length) return `Replies are drafts only on ${andList(drafts)}`;
  return "Replies are off";
}

type ChipView = { label: string; tone: "neutral" | "warn" | "danger" };
/** Reason id → short words, most important first. */
const REASONS: Array<[string, ChipView]> = [
  ["threat", { label: "Threat", tone: "danger" }],
  ["doxxing", { label: "Personal info", tone: "danger" }],
  ["scam", { label: "Scam", tone: "danger" }],
  ["location/schedule", { label: "Location", tone: "warn" }],
  ["blocklist", { label: "Private word", tone: "warn" }],
  ["brand/business", { label: "Business", tone: "neutral" }],
  ["link", { label: "Has a link", tone: "neutral" }],
  ["question", { label: "Question", tone: "neutral" }],
  ["own comment", { label: "Your comment", tone: "neutral" }],
  ["plain praise", { label: "Praise", tone: "neutral" }],
  ["rhetorical praise", { label: "Praise", tone: "neutral" }],
  ["low confidence", { label: "Not sure", tone: "neutral" }],
  ["model refused", { label: "Not sure", tone: "neutral" }],
];

/** One triage Chip per item (promo items show their rule as a sentence instead). */
export function reasonChip(bucket: string | null | undefined, reason: string | null | undefined): ChipView | null {
  if (!reason || bucket === "spam_promo") return null;
  const parts = reason.split(";").map((s) => s.trim()).filter(Boolean);
  for (const [id, view] of REASONS) if (parts.includes(id)) return view;
  const first = parts[0] ?? "";
  if (!first || first.startsWith("lint")) return first ? { label: "Reply needs a check", tone: "warn" } : null;
  return { label: first[0]!.toUpperCase() + first.slice(1), tone: bucket === "hide_flag" ? "danger" : "neutral" };
}

const PROMO_TEXT: Record<string, string> = {
  "send-to": "asks you to send the clip to another page",
  "praise-send": "asks you to send the clip to another page",
  "dm-feature": "offers a feature if you message them",
  "promote-on": "offers to promote your clip on their page",
  "get-featured": "offers to get you featured",
  "feature-you": "says they'd love to feature you",
  "paid-promo": "sells paid promotion",
  s4s: "asks for a shoutout swap",
  "check-our-page": "asks you to check out their page",
  growth: "sells followers or growth",
};

export function promoReasonText(reason: string | null | undefined): string {
  const id = (reason ?? "").split(";")[0]!.trim().replace(/^promo:/, "");
  if (id === "list") return "On your always-ignore list";
  return PROMO_TEXT[id] ? `Looks like a promo account: ${PROMO_TEXT[id]}` : "Looks like a promo account";
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const stop = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** The ?note= / ?error= an action redirected with, in plain words. */
export function resultNotice(q: { note?: string | undefined; error?: string | undefined }): { tone: "info" | "danger"; text: string } | null {
  if (q.error) {
    const e = q.error.trim();
    if (/killed/.test(e)) return { tone: "danger", text: "Not sent: replies are paused. Resume them in Settings." };
    return { tone: "danger", text: `Not sent: ${stop(e)}` };
  }
  const n = q.note?.trim();
  if (!n) return null;
  if (n.startsWith("dry run")) return { tone: "info", text: "Dry run: nothing was sent. The reply is saved as approved." };
  if (n.startsWith("queued")) return { tone: "info", text: "Approved. It goes out within a few minutes." };
  if (n === "already queued") return { tone: "info", text: "Already approved. It's on its way." };
  return { tone: "info", text: stop(cap(n)) };
}

export interface CardPlan {
  /** The one solid button: approve the draft, write a reply, copy a DM draft, or none. */
  primary: "approve" | "write" | "copy" | "none";
  /** One quiet line when there is no primary action ("TikTok replies aren't supported here"). */
  note: string | null;
  /** Sent filter: the reply's state. */
  status: { label: string; tone: "neutral" | "accent" | "warn" | "danger" } | null;
  /** Ignored filter: the matched rule in plain words. */
  rule: string | null;
  canHide: boolean;
  canDismiss: boolean;
  canIgnoreAccount: boolean;
  canNotSpam: boolean;
}

const SENT_STATUS: Partial<Record<string, CardPlan["status"]>> = {
  planned: { label: "Queued", tone: "neutral" },
  sending: { label: "Sending", tone: "neutral" },
  sent: { label: "Sent", tone: "accent" },
  failed: { label: "Failed", tone: "danger" },
  unknown: { label: "Check on the platform", tone: "warn" },
};

export function cardPlan(row: InboxListRow, filter: InboxFilter): CardPlan {
  const has = (a: InboxListRow["actions"][number]) => row.actions.includes(a);
  const base: CardPlan = {
    primary: "none",
    note: null,
    status: null,
    rule: null,
    canHide: has("hide"),
    canDismiss: row.kind === "comment" && has("done"),
    canIgnoreAccount: has("ignore-account"),
    canNotSpam: has("not-spam"),
  };
  // Ignored: "Not spam", or put the account on the always-ignore list (unless the list is why it's here).
  if (filter === "ignored") return { ...base, rule: promoReasonText(row.reason), canDismiss: false, canIgnoreAccount: !(row.reason ?? "").startsWith("promo:list"), canHide: false };
  if (filter === "sent") return { ...base, status: SENT_STATUS[row.replyStatus ?? ""] ?? null, canDismiss: false, canIgnoreAccount: false, canHide: false };
  if (row.kind === "dm") return { ...base, primary: row.draftId && row.draftedReply ? "copy" : "none" };
  if (row.bucket === "hide_flag") return { ...base, note: "Flagged as abusive: no reply from here." };
  return { ...base, primary: row.draftedReply?.trim() ? "approve" : "write" };
}

export function emptyFor(kind: InboxKind, filter: InboxFilter): { title: string; body: string; action: { href: string; label: string } } {
  if (kind === "dms") {
    if (filter === "needs-you")
      return { title: "No messages waiting", body: "DMs are read and drafted only; you answer in the Instagram app. DM drafts are switched on in Settings.", action: { href: "/settings", label: "Open Settings" } };
    if (filter === "ignored") return { title: "Nothing ignored", body: "Promo messages land here instead of in your DMs.", action: { href: inboxHref("dms", "needs-you"), label: "Back to DMs" } };
    return { title: filter === "drafted" ? "No drafts" : "Nothing copied yet", body: "Drafts you copy into Instagram show up under Sent.", action: { href: inboxHref("dms", "needs-you"), label: "Back to DMs" } };
  }
  if (filter === "needs-you") return { title: "No one is waiting", body: "Comments that need your own words show up here. Drafted replies wait for one tap.", action: { href: inboxHref("comments", "drafted"), label: "See drafted replies" } };
  if (filter === "drafted") return { title: "No drafts waiting", body: "Replies drafted for praise and simple comments wait here for your OK.", action: { href: inboxHref("comments", "needs-you"), label: "See what needs you" } };
  if (filter === "sent") return { title: "Nothing sent yet", body: "Replies you approve show up here with their state.", action: { href: inboxHref("comments", "drafted"), label: "See drafted replies" } };
  return { title: "Nothing ignored", body: "Promo spam (“send it to @page”) lands here and never gets a reply.", action: { href: inboxHref("comments", "needs-you"), label: "Back to the inbox" } };
}

/** DM reply-window helper line (Instagram's 24 h window). */
export function dmWindowText(w: { open: boolean; msLeft: number }): string {
  if (!w.open || w.msLeft <= 0) return "Reply window closed: copy the draft, then open Instagram";
  const min = Math.floor(w.msLeft / 60_000);
  const h = Math.floor(min / 60);
  if (min < 1) return "Reply window closes in under a minute";
  return h > 0 ? `Reply window closes in ${h} h ${min % 60} min` : `Reply window closes in ${min} min`;
}

/** /inbox/item/[id]: the same plan as a list card, from the single-item loader's state. */
export function itemPlan(item: Pick<InboxItem, "platform" | "state" | "draftedReply" | "triage" | "reply" | "isOwn">): CardPlan {
  const bucket = item.triage?.bucket ?? null;
  const reason = item.triage?.reasons.join("; ") ?? null;
  const base: CardPlan = { primary: "none", note: null, status: null, rule: null, canHide: false, canDismiss: false, canIgnoreAccount: false, canNotSpam: false };
  const open = { ...base, canDismiss: true, canIgnoreAccount: true };
  switch (item.state) {
    case "untriaged":
      return { ...base, note: "Not sorted yet. Check back in a minute." };
    case "ignored":
      return { ...base, rule: promoReasonText(reason), canNotSpam: true, canIgnoreAccount: !(reason ?? "").startsWith("promo:list") };
    case "needs-you":
    case "drafted":
      if (item.isOwn) return { ...base, note: "This is your own comment." };
      if (bucket === "hide_flag") return { ...open, note: "Flagged as abusive: no reply from here.", canHide: item.platform === "instagram" };
      return { ...open, primary: item.draftedReply?.trim() ? "approve" : "write" };
    case "queued":
      return { ...base, status: SENT_STATUS.planned! };
    case "sent":
      return { ...base, status: SENT_STATUS.sent! };
    case "failed":
      return { ...base, status: SENT_STATUS.failed!, note: item.reply?.lastError ? `It failed: ${item.reply.lastError}` : "It failed. See Notifications." };
    case "unknown":
      return { ...base, status: SENT_STATUS.unknown!, note: "The send timed out. Check the thread on the platform before trying again." };
    case "cancelled":
      return { ...base, status: { label: "Cancelled", tone: "neutral" }, note: "You had already replied in the thread." };
    case "done":
      return { ...base, status: { label: "Done", tone: "neutral" }, note: "Dismissed without a reply." };
  }
}
