import type { Platform } from "@autopilot/core";
import type { CapsView } from "./caps.js";

/** "Saved · default 5 · max 25" / "Default · max 25" under a cap input. Pure. */
export function capHelper(p: Platform, caps: Pick<CapsView, "stored" | "defaults" | "limits">): string {
  const stored = caps.stored[p];
  const max = `max ${caps.limits[p]}`;
  if (stored === undefined || stored === caps.defaults[p]) return `Default · ${max}`;
  return `Saved · default ${caps.defaults[p]} · ${max}`;
}

/** The "Editor approval counts" confirm sheet text (shown before turning it on). */
export const EDITOR_APPROVAL_CONFIRM =
  "Renders you approve in your editing chats (trade recaps, workout assembly) will be scheduled automatically — no second tap here. Only when the render has your editor approval and zero warnings. You'll get a push 'Scheduled: … at …' and can pull it back from the calendar. Captions Claude drafts for renders without a sidecar still need your tap.";
