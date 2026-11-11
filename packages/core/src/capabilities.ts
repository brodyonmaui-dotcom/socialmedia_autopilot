import type { Platform, PlatformCapability } from "./types.js";

/** Matches the "Platform routes" table in CLAUDE.md — keep the two in sync. */
export const CAPABILITIES: Record<Platform, PlatformCapability> = {
  instagram: {
    route: "direct",
    scheduling: "server-fires",
    commentHandling: "polling",
    notes: "Graph API; containers expire in 24h, never pre-create; ≤5 hashtags; webhooks only if proven.",
  },
  youtube: {
    route: "direct",
    scheduling: "native",
    commentHandling: "polling",
    notes: "Data API v3; upload private + status.publishAt; YouTube holds the clock.",
  },
  tiktok: {
    route: "middleman",
    scheduling: "native",
    commentHandling: "webhook",
    notes: "Zernio Business-API lane; public-only direct posts, scheduledFor + Idempotency-Key; sound-dependent posts go as draft:true (inbox).",
  },
  snapchat: {
    route: "assisted",
    scheduling: "none",
    commentHandling: "none",
    notes: "Web Share API -> iOS share sheet -> Snapchat; 1 Spotlight/day.",
  },
};
