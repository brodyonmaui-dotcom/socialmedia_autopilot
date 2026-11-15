import type { Platform } from "@autopilot/core";
import type { CapsView } from "./caps.js";

/** "Saved · default 5 · max 25" / "Default · max 25" under a cap input. Pure. */
export function capHelper(p: Platform, caps: Pick<CapsView, "stored" | "defaults" | "limits">): string {
  const stored = caps.stored[p];
  const max = `max ${caps.limits[p]}`;
  if (stored === undefined || stored === caps.defaults[p]) return `Default · ${max}`;
  return `Saved · default ${caps.defaults[p]} · ${max}`;
}
