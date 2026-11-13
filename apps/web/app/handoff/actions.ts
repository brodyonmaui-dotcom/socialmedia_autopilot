"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";
import { dropItem, handoffContext, markPosted, skipToNextDay } from "../../lib/handoff/store.js";
import type { ActionResult } from "../../lib/handoff/types.js";

/** Runs a store write; DB errors become a fixed message (never echoed), then /handoff and home refresh. */
async function run(name: string, fn: () => Promise<ActionResult>): Promise<ActionResult> {
  let out: ActionResult;
  try {
    out = await fn();
  } catch (err) {
    console.error(`handoff ${name} failed: ${(err as Error).name}`);
    out = { ok: false, reason: "something went wrong" };
  }
  revalidatePath("/handoff");
  revalidatePath("/");
  return out;
}

/** approved → published after sharing. `url` is the optional pasted Spotlight link (snapchat.com https only; anything else is dropped). */
export async function markPostedAction(itemId: string, url?: string | null): Promise<ActionResult> {
  const session = await requireSession();
  return run("mark-posted", () => markPosted(getPool(), String(itemId), session.id, typeof url === "string" ? url : null, new Date()));
}

/** Moves the item to the next free creator-local day, same local time. `to` = the new day (YYYY-MM-DD). */
export async function skipAction(itemId: string): Promise<ActionResult> {
  const session = await requireSession();
  const { timeZone } = handoffContext();
  if (!timeZone) return { ok: false, reason: "TZ_CREATOR not set" };
  return run("skip", () => skipToNextDay(getPool(), String(itemId), session.id, timeZone, new Date()));
}

/** Reject (F2 semantics) + a snap-drop event. */
export async function dropAction(itemId: string): Promise<ActionResult> {
  const session = await requireSession();
  return run("drop", async () => {
    const r = await dropItem(getPool(), String(itemId), session.id, new Date());
    return r.ok ? { ok: true } : { ok: false, reason: r.reason ?? "refused" };
  });
}
