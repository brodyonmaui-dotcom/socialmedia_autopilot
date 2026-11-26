"use server";

import { revalidatePath } from "next/cache";
import { blocklistFromEnv } from "@autopilot/research";
import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";
import { requestStudioRender } from "../../lib/studio/data.js";

/**
 * Studio export (F24). Needs a session; validates the edit (lib/studio/data.ts requestStudioRender) and queues ONE
 * media_edits row of kind 'studio' for the worker. Never publishes or approves: the result lands in the Library
 * (folder "Studio") and in Ready to post, where the creator watches it and taps Approve & schedule.
 * DB errors become a fixed message (never echoed).
 */
export async function queueStudioRenderAction(edlJson: string): Promise<{ ok: true; editId: string } | { ok: false; error: string }> {
  await requireSession();
  try {
    const r = await requestStudioRender(getPool(), edlJson, { blocklist: blocklistFromEnv(process.env) });
    if (r.ok) revalidatePath("/library");
    return r;
  } catch (err) {
    console.error(`studio render request failed: ${(err as Error).name}`);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}
