import { NonRetryableError } from "@autopilot/core";
import type { CommentSource } from "@autopilot/engagement";

const DISABLED = "tiktok comments disabled: free Zernio plan; replies are manual";

/**
 * TikTok comments are not available on our route (free Zernio plan, decisions.md), so this source is a
 * stub: polling returns nothing (so the poll job never errors) and every other method refuses.
 */
export function createTikTokCommentSource(): CommentSource {
  return {
    platform: "tiktok",
    async fetchRecent(cursor) {
      return { comments: [], cursor };
    },
    async fetchThread() {
      throw new NonRetryableError(DISABLED);
    },
    async reply() {
      throw new NonRetryableError(DISABLED);
    },
    async hide() {
      throw new NonRetryableError(DISABLED);
    },
  };
}
