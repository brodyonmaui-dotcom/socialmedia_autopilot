"use server";

import type { EngagementPlatform, Mode } from "@autopilot/engagement";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import {
  blockAuthor,
  createManualAction,
  getComment,
  INBOX_TABS,
  markDraftCopied,
  markHandled,
  promoteShadow,
  writeEngagementAlert,
} from "../../lib/engagement/queries.js";
import { setKilled, setMode } from "../../lib/engagement/settings.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS: readonly EngagementPlatform[] = ["instagram", "youtube", "tiktok"];
const MODES: readonly Mode[] = ["off", "shadow", "live"];

class UserError extends Error {
  override name = "UserError";
}

const field = (fd: FormData | undefined, k: string) => (fd ? String(fd.get(k) ?? "") : "");

/** Back to the tab the form came from (hidden "tab" field), else the flagged tab. */
function pathFrom(fd: FormData | undefined): string {
  const tab = field(fd, "tab");
  if (tab === "dms") return "/inbox/dms";
  return (INBOX_TABS as readonly string[]).includes(tab) && tab !== "flagged" ? `/inbox?tab=${tab}` : "/inbox";
}

/** Same pattern as research/actions.ts run(): errors come back as ?error=… (only our own messages). */
async function run(path: string, fn: () => Promise<string | void>): Promise<void> {
  let error: string | undefined;
  let note: string | undefined;
  try {
    note = (await fn()) ?? undefined;
  } catch (err) {
    const e = err as Error;
    error = e.name === "UserError" ? e.message : "something went wrong";
    if (e.name !== "UserError") console.error(`inbox action failed: ${e.name}`);
  }
  revalidatePath("/inbox");
  revalidatePath("/inbox/dms");
  revalidatePath("/");
  const sep = path.includes("?") ? "&" : "?";
  if (error) redirect(`${path}${sep}error=${encodeURIComponent(error)}`);
  if (note) redirect(`${path}${sep}note=${encodeURIComponent(note)}`);
  redirect(path);
}

export async function markHandledAction(commentId: string, fd?: FormData): Promise<void> {
  const session = await requireSession();
  await run(pathFrom(fd), async () => {
    if (!UUID.test(commentId)) throw new UserError("unknown comment");
    const changed = await markHandled(getPool(), commentId, new Date());
    return changed ? "marked done" : "already done";
  });
}

export async function blockAuthorAction(platform: string, authorId: string, fd?: FormData): Promise<void> {
  const session = await requireSession();
  await run(pathFrom(fd), async () => {
    if (!(PLATFORMS as readonly string[]).includes(platform)) throw new UserError("unknown platform");
    if (!authorId) throw new UserError("this comment has no author id");
    await blockAuthor(getPool(), platform as EngagementPlatform, authorId);
    return "no more auto-replies to this person";
  });
}

/** Plans a manual reply (the stored draft) or hide. The worker picks it up on its next tick if live and not killed. */
export async function sendManualAction(commentId: string, kind: "reply" | "hide", fd?: FormData): Promise<void> {
  const session = await requireSession();
  await run(pathFrom(fd), async () => {
    if (!UUID.test(commentId)) throw new UserError("unknown comment");
    if (kind !== "reply" && kind !== "hide") throw new UserError("unknown action");
    const pool = getPool();
    const c = await getComment(pool, commentId);
    if (!c) throw new UserError("unknown comment");
    if (c.isOwn) throw new UserError("that's your own comment");
    if (kind === "reply" && !c.draft?.trim()) throw new UserError("no draft reply stored for this comment");
    if (kind === "hide" && !(c.platform === "instagram" && c.bucket === "hide_flag")) throw new UserError("hide is only for flagged Instagram comments");
    const r = await createManualAction(pool, commentId, kind, kind === "reply" ? c.draft!.trim() : null, new Date());
    if (!r.ok) throw new UserError(r.reason);
    return kind === "reply" ? "reply queued for the worker" : "hide queued for the worker";
  });
}

/** Shadow tab: turns the stored shadow reply into a planned manual one (the worker picks it up on its next tick). */
export async function promoteShadowAction(actionId: string, fd?: FormData): Promise<void> {
  const session = await requireSession();
  await run(pathFrom(fd), async () => {
    if (!UUID.test(actionId)) throw new UserError("unknown reply");
    const ok = await promoteShadow(getPool(), actionId, new Date());
    if (!ok) throw new UserError("already promoted or sent");
    return "reply queued for the worker";
  });
}

/**
 * on = true kills auto-replies (one tap, reason optional); on = false resumes and needs the word
 * "resume" typed in the form's "confirm" field (or passed as the string argument).
 */
export async function setKillAction(on: boolean, input?: string | FormData): Promise<void> {
  const session = await requireSession();
  const fd = input instanceof FormData ? input : undefined;
  const text = (typeof input === "string" ? input : field(fd, on ? "reason" : "confirm")).trim().slice(0, 200);
  await run(pathFrom(fd), async () => {
    const pool = getPool();
    if (on) {
      const reason = text || "no reason given";
      await setKilled(pool, true, reason);
      await writeEngagementAlert(pool, "engagement-kill", "all", `killed from the inbox: ${reason}`);
      return "auto-replies killed";
    }
    if (text.toLowerCase() !== "resume") throw new UserError('type "resume" to turn auto-replies back on');
    await setKilled(pool, false);
    return "auto-replies resumed (each platform still follows its mode)";
  });
}

export async function setModeAction(platform: string, mode: string, fd?: FormData): Promise<void> {
  const session = await requireSession();
  await run(pathFrom(fd), async () => {
    if (!(PLATFORMS as readonly string[]).includes(platform)) throw new UserError("unknown platform");
    if (!(MODES as readonly string[]).includes(mode)) throw new UserError("unknown mode");
    const pool = getPool();
    const p = platform as EngagementPlatform;
    const { before, after } = await setMode(pool, p, mode as Mode);
    if (before.mode[p] !== after.mode[p]) await writeEngagementAlert(pool, "engagement-mode", p, `mode ${p}: ${before.mode[p]} → ${after.mode[p]}`);
    return `${p}: ${after.mode[p]}`;
  });
}

/** Marks a DM draft as copied. No redirect: the client copies to the clipboard and stays put. */
export async function copyDraftAction(draftId: string): Promise<void> {
  const session = await requireSession();
  if (!UUID.test(draftId)) return;
  await markDraftCopied(getPool(), draftId);
  revalidatePath("/inbox/dms");
}
