// Static demo data for the /design style guide. Invented, generic content only: no people, places, real accounts or photos.

export const NAV = [
  { id: "home", label: "Home", href: "/design?view=home", icon: "home" as const },
  { id: "batches", label: "Batches", href: "/design?view=batch", icon: "batches" as const, badge: 6 },
  { id: "inbox", label: "Inbox", href: "/design?view=components", icon: "inbox" as const, badge: 7 },
  { id: "analytics", label: "Analytics", href: "/design?view=home#numbers", icon: "analytics" as const },
  { id: "more", label: "More", href: "/design?view=components", icon: "more" as const },
];

export const WEEK = { number: 47, label: "Week of Nov 16", approved: 18, total: 24, pending: 6, warnings: 2 };

export const HERO_READOUT = [
  { k: "Pending", v: "06 posts" },
  { k: "Next post", v: "09:00 · IG" },
  { k: "Alerts", v: "02 open" },
  { k: "Outbox", v: "0 failed" },
];

export const SYSTEM_STATUS = [
  { label: "INSTAGRAM", value: 100, note: "graph api" },
  { label: "YOUTUBE", value: 100, note: "data api v3" },
  { label: "TIKTOK", value: 67, note: "1 draft waits" },
  { label: "SNAPCHAT", value: 50, note: "tap to share" },
];

export const MARQUEE = [
  { text: "Instagram", style: "stroke" as const },
  { text: "YouTube", style: "serif" as const },
  { text: "TikTok", style: "stroke" as const },
  { text: "Snapchat", style: "serif" as const },
  { text: "Week 47", style: "stroke" as const },
  { text: "approved", style: "serif" as const },
];

export const NEXT_POSTS = [
  { id: "p1", platform: "instagram" as const, title: "Morning stretch", meta: "09:00 · REEL · 0:42", sub: "in 2 h" },
  { id: "p2", platform: "youtube" as const, title: "Rest-day meals", meta: "12:30 · SHORT · 0:55", sub: "scheduled" },
  { id: "p3", platform: "tiktok" as const, title: "One-pan dinner", meta: "17:15 · INBOX DRAFT · NEEDS SOUND", sub: "needs sound" },
  { id: "p4", platform: "snapchat" as const, title: "Desk, before & after", meta: "19:00 · SPOTLIGHT · TAP TO SHARE", sub: "tap to share" },
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

export const STATEMENT = {
  text: "Hooks under two seconds held viewers 31% longer than the slow openers.",
  source: "Weekly report · W46 · n = 22 posts",
};

export const JOURNAL = [
  { date: "NOV 12", tag: "REPORT", text: "Reels posted before 10:00 out-reached evening slots for the third week running." },
  { date: "NOV 10", tag: "INBOX", text: "Auto-replies paused for 2 h after a burst of off-topic comments; resumed on review." },
  { date: "NOV 08", tag: "TRIAL", text: "Two trial reels cleared the share bar — recommended for the main feed." },
];

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
  index: "03",
  day: "TUE · NOV 17",
  time: "09:00",
  title: "Morning stretch",
  caption:
    "Three minutes, no equipment, and your back will thank you by lunch. Save this for tomorrow morning and tell me which move felt best.",
  platforms: ["instagram", "youtube", "tiktok"] as const,
  duration: "0:42",
  hashtags: 4,
  warning: "TikTok: sound-dependent → goes as inbox draft",
};
