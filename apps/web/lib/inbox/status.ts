import type { Pool } from "pg";
import type { EngagementPlatform, EngagementSettings, PingMode } from "@autopilot/engagement";
import { loadEngagement, updateEngagement } from "../engagement/settings.js";
import { PING_MODES } from "@autopilot/engagement/src/settings.js";

/** Run 4: one line per platform for the inbox header, and the pings setting. Read-only except setPings. */

export type ReplyStatusLabel = "off" | "drafts only" | "auto" | "held (killed)";
export interface ReplyStatusLine {
  platform: EngagementPlatform;
  label: ReplyStatusLabel;
  /** "Instagram: drafts only" */
  line: string;
}

const NAME: Record<EngagementPlatform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok" };
const PLATFORMS: readonly EngagementPlatform[] = ["instagram", "youtube", "tiktok"];

/** Pure: off → off, shadow → drafts only, live → auto (held while killed). */
export function replyStatus(s: Pick<EngagementSettings, "mode" | "killed">, killEnv = false): ReplyStatusLine[] {
  return PLATFORMS.map((p) => {
    const m = s.mode[p];
    const label: ReplyStatusLabel = m === "off" ? "off" : m === "shadow" ? "drafts only" : s.killed || killEnv ? "held (killed)" : "auto";
    return { platform: p, label, line: `${NAME[p]}: ${label}` };
  });
}

export async function loadReplyStatus(pool: Pool, env: Record<string, string | undefined> = process.env): Promise<{ lines: ReplyStatusLine[]; pings: PingMode }> {
  const s = await loadEngagement(pool);
  const kill = (env.ENGAGEMENT_KILL ?? "").trim().toLowerCase();
  return { lines: replyStatus(s, kill === "1" || kill === "true"), pings: s.pings };
}

/** engagement.pings = each | hourly | off (a notification setting; it never sends anything public). */
export async function setPings(pool: Pool, mode: PingMode): Promise<{ before: PingMode; after: PingMode }> {
  if (!(PING_MODES as readonly string[]).includes(mode)) throw new Error("unknown ping mode");
  const { before, after } = await updateEngagement(pool, (o) => ({ ...o, pings: mode }));
  return { before: before.pings, after: after.pings };
}
