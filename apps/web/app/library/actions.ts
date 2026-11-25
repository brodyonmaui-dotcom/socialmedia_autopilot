"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";
import { dismissIssue, keepAllFixes, keepFix, keepOriginal, moveToFolder, requestFix, type KeepAllResult, type KeepFixResult, type RequestFixResult } from "../../lib/library/data.js";

/**
 * Touch-up server actions. Every one needs a session; DB errors become a fixed message (never echoed).
 * None of them publishes, deletes or touches a file: they queue work for the worker or change a status.
 */

export type ActionResult<T> = ({ ok: true } & T) | { ok: false; reason: string };

async function guarded<T extends object>(name: string, fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  let out: ActionResult<T>;
  try {
    out = await fn();
  } catch (err) {
    console.error(`library ${name} failed: ${(err as Error).name}`);
    out = { ok: false, reason: "something went wrong" };
  }
  revalidatePath("/library/touch-up");
  revalidatePath("/library");
  return out;
}

const strings = (v: FormDataEntryValue[]): string[] => v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());

/**
 * "Fix it" / "Fix all shown": repeated `mediaId` fields (exactly the clips the page rendered), optional
 * repeated `op` fields (absent = each clip's default fixes; "remove-gaps" only when sent by name).
 */
export async function requestFixAction(formData: FormData): Promise<ActionResult<RequestFixResult>> {
  const session = await requireSession();
  const ids = strings(formData.getAll("mediaId"));
  const ops = strings(formData.getAll("op"));
  if (ids.length === 0) return { ok: false, reason: "no clips selected" };
  return guarded("request-fix", async () => ({ ok: true, ...(await requestFix(getPool(), ids, ops.length ? ops : undefined, session.id)) }));
}

/** "Keep the fix" (form field `fixId`): draft calendar items move to the fixed clip; approved ones stay. */
export async function keepFixAction(formData: FormData): Promise<KeepFixResult> {
  const session = await requireSession();
  const fixId = String(formData.get("fixId") ?? "");
  return guarded<{ repointed: number; stayed: number }>("keep-fix", () => keepFix(getPool(), fixId, session.id));
}

/** "Keep all N fixes": every finished fix, each through the same rules as Keep the fix. */
export async function keepAllFixesAction(): Promise<ActionResult<KeepAllResult>> {
  const session = await requireSession();
  return guarded("keep-all", async () => ({ ok: true, ...(await keepAllFixes(getPool(), session.id, new Date())) }));
}

/** "Keep the original" (form field `fixId`). */
export async function keepOriginalAction(formData: FormData): Promise<ActionResult<object>> {
  await requireSession();
  const fixId = String(formData.get("fixId") ?? "");
  return guarded("keep-original", async () => ((await keepOriginal(getPool(), fixId)).ok ? { ok: true } : { ok: false, reason: "this fix can't be discarded" }));
}

/** "Dismiss" one issue (form fields `mediaId`, `code`). */
export async function dismissIssueAction(formData: FormData): Promise<ActionResult<object>> {
  const session = await requireSession();
  const mediaId = String(formData.get("mediaId") ?? "");
  const code = String(formData.get("code") ?? "");
  return guarded("dismiss", async () => ((await dismissIssue(getPool(), mediaId, code, session.id)).ok ? { ok: true } : { ok: false, reason: "unknown clip or issue" }));
}

/**
 * "Move to folder…" (form fields `mediaId`, `folder` = a new name, `existing` = a label already in use; a typed
 * name wins, both blank clears the folder). Same label rules as the ingest `--folder` flag. Only the label changes.
 */
export async function moveToFolderAction(formData: FormData): Promise<ActionResult<{ folder: string | null }>> {
  await requireSession();
  const typed = String(formData.get("folder") ?? "").trim();
  const chosen = typed || String(formData.get("existing") ?? "");
  return guarded("move-folder", async () => moveToFolder(getPool(), String(formData.get("mediaId") ?? ""), chosen));
}
