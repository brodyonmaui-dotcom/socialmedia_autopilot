// Pure nav model for the v3 shell (Sidebar + top bar). No DB, no React: tested in __tests__/app-nav.test.ts.
import type { IconName } from "./ui/Icon.js";

/** A sidebar link. `id` is what a page passes as AppFrame `active`. Hrefs are basePath-free. */
export interface NavLink {
  id: string;
  label: string;
  href: string;
  badge?: number;
}

/** A top-level sidebar entry: a link, or an expandable group of links. */
export interface NavEntry extends NavLink {
  icon: IconName;
  children?: NavLink[];
}

/** Badge counts from cheap queries; undefined = unknown (no badge rather than a wrong number). */
export interface FrameCounts {
  /** Draft posts waiting for approval (any week). */
  draftPosts?: number;
  /** Flagged comments not handled yet. */
  flagged?: number;
  /** DM threads waiting inside their 24 h window. */
  dmsOpen?: number;
  openAlerts?: number;
  /** Clips with open Touch-up issues (same "flagged" as loadTouchUp). */
  touchUp?: number;
}

const PLATFORM_LINKS = (base: string, idBase: string): NavLink[] => [
  { id: `${idBase}/instagram`, label: "Instagram", href: `${base}/instagram` },
  { id: `${idBase}/youtube`, label: "YouTube", href: `${base}/youtube` },
  { id: `${idBase}/tiktok`, label: "TikTok", href: `${base}/tiktok` },
  { id: `${idBase}/snapchat`, label: "Snapchat", href: `${base}/snapchat` },
];

/** The sidebar, in order (ui-system.md "Shell"). */
export function sidebarNav(counts: FrameCounts = {}): NavEntry[] {
  return [
    { id: "home", label: "Home", href: "/", icon: "home" },
    { id: "calendar", label: "Calendar", href: "/calendar", icon: "calendar", badge: badgeOf(counts.draftPosts) },
    { id: "inbox", label: "Inbox", href: "/inbox", icon: "inbox", badge: inboxBadge(counts) },
    {
      id: "analytics",
      label: "Analytics",
      href: "/analytics",
      icon: "analytics",
      children: [{ id: "analytics", label: "Overview", href: "/analytics" }, ...PLATFORM_LINKS("/analytics", "analytics")],
    },
    { id: "research", label: "Research", href: "/research", icon: "research" },
    {
      id: "library",
      label: "Library",
      href: "/library",
      icon: "library",
      children: [
        { id: "library", label: "All clips", href: "/library" },
        { id: "library/touch-up", label: "Touch-up", href: "/library/touch-up", badge: badgeOf(counts.touchUp) },
      ],
    },
    { id: "platforms", label: "Platforms", href: "/platforms/instagram", icon: "platforms", children: PLATFORM_LINKS("/platforms", "platforms") },
    { id: "settings", label: "Settings", href: "/settings", icon: "settings" },
  ];
}

/** v2 section ids pages still pass → the v3 nav id they light up. */
const LEGACY: Record<string, string> = {
  batches: "calendar",
  alerts: "notifications",
  more: "settings",
  handoff: "platforms/snapchat",
  "touch-up": "library/touch-up",
};

/** The nav id for a page's `active` value (legacy ids mapped; unknown stays as-is and lights nothing). */
export function navId(active: string): string {
  return LEGACY[active] ?? active;
}

/**
 * Which entry and which child are current for `active`, and which groups start open (the group that
 * contains the current page). `aria-current="page"` goes on exactly one link.
 */
export function activeState(nav: NavEntry[], active: string): { entryId: string | null; linkHref: string | null; openGroups: string[] } {
  const id = navId(active);
  for (const e of nav) {
    if (e.children) {
      const child = e.children.find((c) => c.id === id);
      if (child) return { entryId: e.id, linkHref: child.href, openGroups: [e.id] };
      if (e.id === id) return { entryId: e.id, linkHref: e.children[0]?.href ?? e.href, openGroups: [e.id] };
    } else if (e.id === id) {
      return { entryId: e.id, linkHref: e.href, openGroups: [] };
    }
  }
  return { entryId: null, linkHref: null, openGroups: [] };
}

/** A count worth showing as a badge: a positive finite integer. */
export function badgeOf(n: number | undefined): number | undefined {
  return n != null && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** Inbox badge = flagged comments + DMs waiting (unknown parts count as 0; all unknown → no badge). */
export function inboxBadge(c: FrameCounts): number | undefined {
  if (c.flagged == null && c.dmsOpen == null) return undefined;
  return badgeOf((c.flagged ?? 0) + (c.dmsOpen ?? 0));
}

/** Static page list for search (Pages group). Same order and hrefs as the sidebar. */
export function pageLinks(): Array<{ label: string; href: string; keywords: string }> {
  const out: Array<{ label: string; href: string; keywords: string }> = [];
  for (const e of sidebarNav()) {
    if (!e.children) out.push({ label: e.label, href: e.href, keywords: e.label.toLowerCase() });
    else
      for (const c of e.children) {
        const label = c.label === "Overview" || c.label === "All clips" ? e.label : `${e.label} · ${c.label}`;
        out.push({ label, href: c.href, keywords: `${e.label} ${c.label}`.toLowerCase() });
      }
  }
  out.push({ label: "Notifications", href: "/notifications", keywords: "notifications alerts" });
  return out;
}
