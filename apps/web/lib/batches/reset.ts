import type { Platform } from "@autopilot/core";
import type { BatchItemEventKind } from "@autopilot/db";

/**
 * F11: pure pieces for "I checked, it's not on the platform" (reset-checked) and "I checked, it IS
 * there" (record-published). No I/O; the caller (actions + store) does the IG lookup and the writes.
 */

/** The two batch_item_events.kind values F11 adds (part of BatchItemEventKind in @autopilot/db). */
export type ResetEventKind = Extract<BatchItemEventKind, "reset-checked" | "record-published">;

/** Result of the IG adapter's read-only `findExisting` (a hit refuses before we get here). Others: "n/a". */
export type AutoCheck = "not-found" | "error" | "n/a";
export const AUTO_CHECKS: readonly AutoCheck[] = ["not-found", "error", "n/a"];

/** Platforms that reach the outbox (Snapchat is assisted and never does). */
export type ResettablePlatform = "instagram" | "youtube" | "tiktok";

export const isResettablePlatform = (p: Platform): p is ResettablePlatform =>
  p === "instagram" || p === "youtube" || p === "tiktok";

/** Every box must be ticked before a reset; the ticked strings go in the event's `detail.checked`. */
export const RESET_CHECKLIST: Readonly<Record<ResettablePlatform, readonly string[]>> = {
  instagram: [
    "Profile grid and Reels tab (newest first)",
    "Trial reels (Professional dashboard → Trial reels)",
    "Caption search isn't needed: the app checked the last 25 posts (result below)",
  ],
  youtube: [
    "YouTube Studio → Content, including Private and Scheduled",
    "Upload drafts / processing in Studio",
  ],
  tiktok: [
    "TikTok profile, including Drafts/Inbox if it went as a draft",
    "Zernio dashboard → Posts, matching the key ending shown above",
    "More than 24 h since the last try, or the post is confirmed absent in Zernio",
  ],
};

/** Exact hosts accepted as evidence per platform (no suffix matching: lookalikes are refused). */
export const POST_URL_HOSTS: Readonly<Record<ResettablePlatform, readonly string[]>> = {
  instagram: ["instagram.com", "www.instagram.com"],
  youtube: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "studio.youtube.com"],
  tiktok: ["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com"],
};

export const MAX_POST_URL_LENGTH = 2048;

/**
 * The normalised URL (parsed `href`, fragment dropped) if `url` is a plausible link to a post on
 * `platform`, else null. Rules: https only, no credentials, no explicit port, host exactly in
 * POST_URL_HOSTS[platform], a path beyond "/". Snapchat → always null.
 */
export function validatePostUrl(platform: Platform, url: string): string | null {
  if (!isResettablePlatform(platform) || typeof url !== "string") return null;
  const raw = url.trim();
  if (raw === "" || raw.length > MAX_POST_URL_LENGTH) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username !== "" || u.password !== "") return null;
  if (u.port !== "") return null;
  if (!POST_URL_HOSTS[platform].includes(u.hostname.toLowerCase())) return null;
  if (u.pathname === "" || u.pathname === "/") return null;
  u.hash = "";
  return u.href;
}

/** Platform post ids we accept from the form: trimmed, 1-128 chars of [A-Za-z0-9_.:-]. */
export const POST_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
