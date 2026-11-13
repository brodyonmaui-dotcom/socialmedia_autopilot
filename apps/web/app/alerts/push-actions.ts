"use server";

import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";
import { InvalidSubscription, requestTestPush, revokeSubscription, saveSubscription, validateSubscription } from "../../lib/push/subscriptions.js";

export type PushActionResult = { ok: true; note?: string } | { ok: false; reason: string };

/** Fixed messages only: never echo the endpoint, keys or a DB error. */
async function run(name: string, fn: () => Promise<PushActionResult>): Promise<PushActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InvalidSubscription) return { ok: false, reason: "this browser sent an unusable subscription" };
    console.error(`push ${name} failed: ${(err as Error).name}`);
    return { ok: false, reason: "something went wrong" };
  }
}

/** Stores the subscription the Enable button got from the browser (after the user's tap). */
export async function subscribeAction(json: unknown, label?: string): Promise<PushActionResult> {
  const session = await requireSession();
  return run("subscribe", async () => {
    await saveSubscription(getPool(), validateSubscription(json), session.id, typeof label === "string" ? label : null);
    return { ok: true };
  });
}

export async function unsubscribeAction(endpoint: unknown): Promise<PushActionResult> {
  await requireSession();
  return run("unsubscribe", async () => {
    if (typeof endpoint !== "string" || endpoint.length > 1024) return { ok: false, reason: "bad endpoint" };
    await revokeSubscription(getPool(), endpoint);
    return { ok: true };
  });
}

/** The worker sends it within a minute (web-push lives in the worker only). */
export async function sendTestAction(): Promise<PushActionResult> {
  await requireSession();
  return run("test", async () =>
    (await requestTestPush(getPool())) ? { ok: true, note: "Test requested: it should arrive within a minute." } : { ok: false, reason: "a test was just requested: wait a minute" },
  );
}
