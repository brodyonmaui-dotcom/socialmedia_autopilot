// Pure nav building for the app frame (AppFrame.tsx). No DB, no React: tested in __tests__/app-nav.test.ts.
import type { IconName } from "./ui/Icon.js";
import type { NavItem } from "./ui/AppShell.js";

/** The five bottom tabs, in order. */
export type TabId = "home" | "batches" | "inbox" | "analytics" | "more";
/** Pages reached through More (and the header menu). */
export type MoreId = "alerts" | "handoff" | "library" | "touch-up" | "research";
/** What a page passes as AppFrame `active`. */
export type Section = TabId | MoreId;

/** Badge counts from cheap queries; undefined = unknown (no badge rather than a wrong number). */
export interface FrameCounts {
  draftBatches?: number;
  flagged?: number;
  openAlerts?: number;
}

export interface MoreLink {
  id: MoreId;
  label: string;
  href: string;
  icon: IconName;
  /** One line under the label on /more and in the menu. */
  hint: string;
  badge?: number;
}

const MORE: ReadonlyArray<Omit<MoreLink, "badge">> = [
  { id: "alerts", label: "Alerts", href: "/alerts", icon: "bell", hint: "Failed, unknown or held posts" },
  { id: "handoff", label: "Snapchat", href: "/handoff", icon: "share", hint: "Tap-to-share handoff, 1 per day" },
  { id: "library", label: "Library", href: "/library", icon: "library", hint: "Ingested clips" },
  { id: "touch-up", label: "Touch-up", href: "/touch-up", icon: "touchUp", hint: "Clips waiting for a clean copy" },
  { id: "research", label: "Research", href: "/research", icon: "research", hint: "Ideas, hooks and briefs" },
];

const MORE_IDS = new Set<string>(MORE.map((m) => m.id));

/** A count worth showing as a badge: a positive finite integer. */
export function badgeOf(n: number | undefined): number | undefined {
  return n != null && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** Which bottom tab lights up for a section: every More page lights "more"; unknown ids light nothing. */
export function tabFor(active: string): TabId | "" {
  if (active === "home" || active === "batches" || active === "inbox" || active === "analytics" || active === "more") return active;
  return MORE_IDS.has(active) ? "more" : "";
}

/** Secondary destinations with their badges (alerts = open alerts). */
export function moreLinks(counts: FrameCounts = {}): MoreLink[] {
  return MORE.map((m) => ({ ...m, badge: m.id === "alerts" ? badgeOf(counts.openAlerts) : undefined }));
}

/**
 * The five tabs (TabBar + desktop header nav). Badges: Batches = draft batches, Inbox = flagged comments,
 * More = open alerts (the alerts page lives under More, so its count must surface on the tab bar).
 */
export function buildNav(counts: FrameCounts = {}): NavItem[] {
  return [
    { id: "home", label: "Home", href: "/", icon: "home" },
    { id: "batches", label: "Batches", href: "/batches", icon: "batches", badge: badgeOf(counts.draftBatches) },
    { id: "inbox", label: "Inbox", href: "/inbox", icon: "inbox", badge: badgeOf(counts.flagged) },
    { id: "analytics", label: "Analytics", href: "/analytics", icon: "analytics" },
    { id: "more", label: "More", href: "/more", icon: "more", badge: badgeOf(counts.openAlerts) },
  ];
}
