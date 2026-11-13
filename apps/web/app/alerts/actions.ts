"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";
import { acknowledge, cleanIds } from "../../lib/alerts/queries.js";

export type AckResult = { ok: true; count: number } | { ok: false; reason: string };

/** Runs an acknowledge; DB errors become a fixed message (never echoed), then /alerts and home refresh. */
async function run(name: string, fn: () => Promise<number>): Promise<AckResult> {
  let out: AckResult;
  try {
    out = { ok: true, count: await fn() };
  } catch (err) {
    console.error(`alerts ${name} failed: ${(err as Error).name}`);
    out = { ok: false, reason: "something went wrong" };
  }
  revalidatePath("/alerts");
  revalidatePath("/");
  return out;
}

/** One card's "Acknowledge" (form field `id`). Already-acknowledged → no change. */
export async function acknowledgeAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const ids = cleanIds([formData.get("id")]);
  await run("ack", () => acknowledge(getPool(), ids, session.id));
}

/**
 * "Acknowledge all shown": exactly the ids the page rendered (repeated `id` fields), so an alert that
 * arrives after the page loaded is never acknowledged unseen. Returns how many changed.
 */
export async function acknowledgeShownAction(formData: FormData): Promise<AckResult> {
  const session = await requireSession();
  const ids = cleanIds(formData.getAll("id"));
  if (ids.length === 0) return { ok: false, reason: "nothing to acknowledge" };
  return run("ack-shown", () => acknowledge(getPool(), ids, session.id));
}
