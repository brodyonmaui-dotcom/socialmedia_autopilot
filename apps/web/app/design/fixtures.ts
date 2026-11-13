// Static demo data for the /design style guide. Invented, generic content only: no people, places or real accounts.

export const NAV = [
  { id: "home", label: "Home", href: "/design?view=home", icon: "home" as const },
  { id: "batches", label: "Batches", href: "/design?view=batch", icon: "batches" as const, badge: 6 },
  { id: "inbox", label: "Inbox", href: "/design?view=components", icon: "inbox" as const, badge: 7 },
  { id: "analytics", label: "Analytics", href: "/design?view=home", icon: "analytics" as const },
  { id: "more", label: "More", href: "/design?view=components", icon: "more" as const },
];

export const ACCOUNTS = [
  { label: "Instagram", value: "3 today", tone: "accent" as const },
  { label: "YouTube", value: "2 today", tone: "accent" as const },
  { label: "TikTok", value: "1 draft", tone: "warn" as const },
  { label: "Snapchat", value: "1 to share", tone: "muted" as const },
];

export const WEEK = { label: "Week of Nov 16", approved: 18, total: 24, pending: 6, warnings: 2 };

export const NEXT_POSTS = [
  { monogram: "IG", title: "Three-minute morning stretch", subtitle: "Instagram · Reel", time: "9:00", sub: "in 2 h" },
  { monogram: "YT", title: "What I eat on a rest day", subtitle: "YouTube · Short", time: "12:30", sub: "scheduled" },
  { monogram: "TT", title: "One-pan dinner, no recipe", subtitle: "TikTok · inbox draft", time: "17:15", sub: "needs sound" },
  { monogram: "SC", title: "Desk setup, before & after", subtitle: "Snapchat · Spotlight", time: "19:00", sub: "tap to share" },
];

export const ALERTS = { open: 2, latest: "TikTok draft is waiting for a sound before it can go out." };

export const INBOX = { flagged: 7, autoReplied: 23 };

/** Views per day, last 14 days (synthetic). */
export const VIEWS_14D = [4.1, 4.8, 4.4, 5.9, 5.2, 6.8, 6.1, 7.4, 6.9, 8.2, 7.6, 9.1, 8.7, 10.4];
export const VIEWS_TOTAL = "104.6k";
export const VIEWS_DELTA = "+18%";

export const PER_PLATFORM = [
  { label: "Instagram", value: 41, tone: "accent" as const },
  { label: "YouTube", value: 28, tone: "hi" as const },
  { label: "TikTok", value: 22, tone: "gray1" as const },
  { label: "Snapchat", value: 9, tone: "gray3" as const },
];

export const POSTS_PER_DAY = [3, 4, 2, 4, 3, 5, 3];
export const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

/** November 2026 posting calendar: day → dot tones. */
export const CALENDAR = {
  year: 2026,
  month0: 10,
  today: 13,
  marks: {
    2: ["muted"], 3: ["muted", "muted"], 5: ["muted"], 6: ["muted"], 9: ["muted", "muted"], 10: ["muted"],
    12: ["muted"], 13: ["accent", "accent"], 14: ["accent"], 16: ["accent", "accent", "accent"],
    17: ["accent", "accent"], 18: ["accent", "warn"], 19: ["accent", "accent"], 20: ["accent"],
    21: ["accent", "accent"], 22: ["accent"],
  } as Record<number, Array<"accent" | "warn" | "muted">>,
};

export const BATCH_POST = {
  day: "Tue · Nov 17",
  time: "9:00",
  title: "Three-minute morning stretch",
  caption:
    "Three minutes, no equipment, and your back will thank you by lunch. Save this for tomorrow morning and tell me which move felt best.",
  platforms: ["Instagram", "YouTube", "TikTok"],
  duration: "0:42",
  hashtags: 4,
  warning: "TikTok: sound-dependent → goes as inbox draft",
};
