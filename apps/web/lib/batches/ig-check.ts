import { sanitizeError, type OutboxPost, type PlatformAdapter } from "@autopilot/core";
import { buildAdapters, credentialsFromEnv } from "@autopilot/adapters";
import type { AutoCheck } from "./reset.js";
import { planTransition, type TransitionResult } from "./transitions.js";
import type { BatchItemView, BatchView } from "./types.js";

/**
 * F11 automatic check: "is this failed/unknown Instagram item already on the account?" One read-only
 * GET through the IG adapter's findExisting (last 25 media, normalised caption within ±36 h of the
 * scheduled time). It never posts. Non-IG → "n/a"; no IG credentials, no time/caption, a lookup error
 * or a timeout → "error" (the manual checklist then decides). A hit → "found" with the permalink.
 */
export type IgCheckResult = { result: AutoCheck | "found"; url?: string; platformPostId?: string };

export interface IgCheckDeps {
  /** Injected in tests; default: the real IG adapter built from env credentials (or none). */
  adapter?: Pick<PlatformAdapter, "findExisting"> | null;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export const IG_CHECK_TIMEOUT_MS = 10_000;

function defaultAdapter(env: Record<string, string | undefined>): Pick<PlatformAdapter, "findExisting"> | null {
  const ig = credentialsFromEnv(env as NodeJS.ProcessEnv).instagram;
  return ig ? (buildAdapters({ instagram: ig }).instagram ?? null) : null;
}

export async function checkInstagram(
  item: Pick<BatchItemView, "id" | "platform" | "caption" | "scheduledFor" | "status" | "attempts">,
  deps: IgCheckDeps = {},
): Promise<IgCheckResult> {
  if (item.platform !== "instagram") return { result: "n/a" };
  const log = deps.log ?? ((line: string) => console.error(line));
  const adapter = deps.adapter !== undefined ? deps.adapter : defaultAdapter(deps.env ?? process.env);
  if (!adapter?.findExisting) return { result: "error" };
  // findExisting matches on caption + time; without both a miss would mean nothing.
  if (!item.scheduledFor || item.caption.trim() === "") return { result: "error" };
  // findExisting reads only caption / scheduledFor; the rest is filler for the type (no key, no media URL).
  const post: OutboxPost = {
    id: item.id,
    idempotencyKey: "",
    platform: "instagram",
    mediaUrl: "",
    caption: item.caption,
    scheduledFor: item.scheduledFor,
    status: item.status as OutboxPost["status"],
    attempts: item.attempts ?? 0,
  };
  try {
    const hit = await adapter.findExisting(post, { signal: AbortSignal.timeout(deps.timeoutMs ?? IG_CHECK_TIMEOUT_MS) });
    if (!hit) return { result: "not-found" };
    return { result: "found", url: hit.platformPostUrl, platformPostId: hit.platformPostId };
  } catch (err) {
    log(`[batches] instagram automatic check failed for item ${item.id}: ${sanitizeError(err)}`);
    return { result: "error" };
  }
}

/**
 * The reset-checked plan with the automatic check run here (server-side), never taken from the form.
 * An IG hit refuses with the found URL so the sheet can offer "It's there" prefilled.
 */
export async function planResetChecked(
  batch: BatchView,
  input: { itemId: string; checked: string[] },
  now: Date,
  deps: IgCheckDeps = {},
): Promise<TransitionResult | { ok: false; reason: string; itemId: string; found: IgCheckResult }> {
  const item = batch.items.find((i) => i.id === input.itemId);
  if (!item) return { ok: false, reason: "item not found in this batch, reload", itemId: input.itemId };
  const check = await checkInstagram(item, deps);
  if (check.result === "found") {
    return {
      ok: false,
      itemId: item.id,
      found: check,
      reason: `It's already on Instagram${check.url ? ` (${check.url})` : ""}: use "It's there" to record it instead of resetting`,
    };
  }
  return planTransition(batch, { kind: "reset-checked", itemId: item.id, checked: input.checked, autoCheck: check.result }, now);
}
