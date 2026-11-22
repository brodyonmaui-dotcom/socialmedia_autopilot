"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "../../lib/db.js";
import { clearSessionCookie, getAuthStore, requireSession } from "../../lib/auth/require.js";
import { writeEngagementAlert } from "../../lib/engagement/queries.js";
import { setDmDrafts, setKilled, setMode } from "../../lib/engagement/settings.js";
import { addPromoAccountByHandle, parsePromoHandle, removePromoAccount } from "../../lib/inbox/promo.js";
import { setPings } from "../../lib/inbox/status.js";
import { writeSettingsAudit } from "../../lib/settings/audit.js";
import { parseCapsForm, updateCaps } from "../../lib/settings/caps.js";
import { parseDailyMinForm, setInstagramDailyMin } from "../../lib/settings/daily-min.js";
import { setIgTrialReels } from "../../lib/settings/ig-trial.js";
import { setTouchupAutofix } from "../../lib/settings/touchup-autofix.js";
import { setEditorApprovalCounts } from "../../lib/settings/editor-approval.js";
import { MODE_LABEL, parseModeChange, PINGS, resumeOk } from "../../lib/settings/replies.js";

/**
 * Settings writes. The reply controls are the inbox's kill-switch / mode / DM-drafts / pings / promo actions
 * moved here with the same checks (resume needs "resume" typed; Auto now also needs "auto" typed) and the same
 * alerts; each change also writes the acknowledged settings audit row. Results come back as ?note= / ?error=.
 */

const PATH = "/settings";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class UserError extends Error {
  override name = "UserError";
}

const field = (fd: FormData | undefined, k: string) => (fd ? String(fd.get(k) ?? "") : "");

/** Runs one write; only our own messages reach the page. Always redirects back to /settings (#section kept). */
async function run(section: string, fn: () => Promise<string>): Promise<void> {
  let q: string;
  try {
    q = `note=${encodeURIComponent(await fn())}`;
  } catch (err) {
    const e = err as Error;
    if (e.name !== "UserError" && !(e instanceof RangeError)) console.error(`settings action failed: ${e.name}`);
    q = `error=${encodeURIComponent(e.name === "UserError" || e instanceof RangeError ? e.message : "couldn't save, nothing changed")}`;
  }
  revalidatePath(PATH);
  revalidatePath("/inbox");
  revalidatePath("/");
  redirect(`${PATH}?${q}#${section}`);
}

/** Form fields: cap-<platform> (whole numbers, 0..CAP_LIMITS). Merges into the 'cadence' row and writes the audit alert. */
export async function saveCapsAction(fd: FormData): Promise<void> {
  await requireSession();
  await run("caps", async () => {
    const parsed = parseCapsForm((k) => (fd.has(k) ? String(fd.get(k)) : null));
    if (!parsed.ok) throw new UserError(parsed.error);
    const min = fd.has("instagram-min") ? parseDailyMinForm(String(fd.get("instagram-min"))) : null;
    if (min && !min.ok) throw new UserError(min.error);
    const { message: capsMessage } = await updateCaps(getPool(), parsed.caps);
    const { message: minMessage } = min ? await setInstagramDailyMin(getPool(), min.value) : { message: "" };
    const message = capsMessage || minMessage;
    return message ? "Daily limits saved. Posts already scheduled don't move." : "Nothing changed";
  });
}

/**
 * Pause all replies (the engagement kill switch). on = true pauses (reason optional, one confirm);
 * on = false resumes and needs "resume" typed in the "confirm" field (checked here, not only in the dialog).
 */
export async function setPauseAction(on: boolean, fd: FormData): Promise<void> {
  await requireSession();
  const text = field(fd, on ? "reason" : "confirm").trim().slice(0, 200);
  await run("replies", async () => {
    const pool = getPool();
    if (on === true) {
      const reason = text || "no reason given";
      await setKilled(pool, true, reason);
      await writeEngagementAlert(pool, "engagement-kill", "all", `killed from settings: ${reason}`);
      await writeSettingsAudit(pool, "replies paused");
      return "All replies paused";
    }
    if (!resumeOk(text)) throw new UserError('type "resume" to turn replies back on');
    await setKilled(pool, false);
    await writeSettingsAudit(pool, "replies resumed");
    return "Replies resumed: each platform follows its own mode again";
  });
}

/** One platform's reply mode (off / shadow / live). Live = "Auto": needs "auto" typed; the worker's live gate still applies. */
export async function setReplyModeAction(platform: string, mode: string, fd: FormData): Promise<void> {
  await requireSession();
  await run("replies", async () => {
    const parsed = parseModeChange(platform, mode, field(fd, "confirm"));
    if (!parsed.ok) throw new UserError(parsed.error);
    const pool = getPool();
    const p = parsed.platform;
    const { before, after } = await setMode(pool, p, parsed.mode);
    if (before.mode[p] !== after.mode[p]) {
      await writeEngagementAlert(pool, "engagement-mode", p, `mode ${p}: ${before.mode[p]} → ${after.mode[p]}`);
      await writeSettingsAudit(pool, `reply mode ${p}: ${before.mode[p]} → ${after.mode[p]}`, p);
    }
    return `${p === "youtube" ? "YouTube" : p === "tiktok" ? "TikTok" : "Instagram"} replies: ${MODE_LABEL[after.mode[p]].toLowerCase()}`;
  });
}

/** DM drafts switch (form field on = "on" | "off"): read-only poll that only drafts. setDmDrafts writes the audit row. */
export async function setDmDraftsAction(fd: FormData): Promise<void> {
  await requireSession();
  await run("replies", async () => {
    const v = field(fd, "on");
    if (v !== "on" && v !== "off") throw new UserError("unknown setting");
    const { after } = await setDmDrafts(getPool(), v === "on");
    return after ? "DM drafts on: read-only, nothing is ever sent" : "DM drafts off";
  });
}

// Fable to review: editor approval counts switch
/**
 * "Editor approval counts" (form field on = "on" | "off"). The UI asks first before turning it on (confirm
 * sheet); turning it off is immediate. setEditorApprovalCounts writes the audit row on a change. Off restores
 * the one-tap "Approve & schedule" as the only way an editor render is approved.
 */
export async function setEditorApprovalAction(fd: FormData): Promise<void> {
  await requireSession();
  await run("editor", async () => {
    const v = field(fd, "on");
    if (v !== "on" && v !== "off") throw new UserError("unknown setting");
    const { after } = await setEditorApprovalCounts(getPool(), v === "on");
    return after ? "Editor approval counts: on. Approved renders with zero warnings are scheduled for you." : "Editor approval counts: off. Every post needs your tap again.";
  });
}

/** Instagram trial reels (form field on = "on" | "off"). Off by default; only takes effect once followers reach the minimum. */
export async function setIgTrialReelsAction(fd: FormData): Promise<void> {
  await requireSession();
  await run("trial-reels", async () => {
    const v = field(fd, "on");
    if (v !== "on" && v !== "off") throw new UserError("unknown setting");
    const { after } = await setIgTrialReels(getPool(), v === "on");
    return after ? "Instagram trial reels on. They start once the account has enough followers; if Instagram refuses one, it goes out as a regular reel." : "Instagram trial reels off. Reels go out as regular reels.";
  });
}

/** Touch-up auto-fix (form field on = "on" | "off"): whether the worker queues fixes for newly flagged clips. */
export async function setTouchupAutofixAction(fd: FormData): Promise<void> {
  await requireSession();
  await run("touchup", async () => {
    const v = field(fd, "on");
    if (v !== "on" && v !== "off") throw new UserError("unknown setting");
    const { after } = await setTouchupAutofix(getPool(), v === "on");
    return after ? "Touch-up auto-fix on. Originals are never changed." : "Touch-up auto-fix off. Nothing is fixed until you tap Fix it.";
  });
}

/** engagement.pings: each | hourly | off (form field "pings"). Phone notifications only. */
export async function setPingsAction(fd: FormData): Promise<void> {
  await requireSession();
  await run("replies", async () => {
    const v = field(fd, "pings");
    if (!(PINGS as readonly string[]).includes(v)) throw new UserError("unknown setting");
    const pool = getPool();
    const { before, after } = await setPings(pool, v as (typeof PINGS)[number]);
    if (before !== after) await writeSettingsAudit(pool, `reply pings ${before} → ${after}`);
    return after === "off" ? "Reply pings off" : after === "hourly" ? "Reply pings: once an hour" : "Reply pings: for each one";
  });
}

/**
 * "Add an account by handle" (form fields platform, handle). Same move as "Always ignore this account" on an
 * inbox item: the account's open items go to Ignored and their pending replies are cancelled (sends less only).
 */
export async function addPromoAccountAction(fd: FormData): Promise<void> {
  await requireSession();
  await run("promo", async () => {
    const parsed = parsePromoHandle(field(fd, "platform"), field(fd, "handle"));
    if ("error" in parsed) throw new UserError(parsed.error);
    const pool = getPool();
    const r = await addPromoAccountByHandle(pool, parsed.platform, parsed.handle, new Date());
    if (!r.added) return `@${parsed.handle} is already on the list`;
    await writeSettingsAudit(pool, "promo account added to the always-ignore list", parsed.platform);
    return `@${parsed.handle} added: the inbox ignores it from now on`;
  });
}

/** Take one account off the always-ignore list (removed_at; nothing is deleted). */
export async function removePromoAccountAction(id: string): Promise<void> {
  await requireSession();
  await run("promo", async () => {
    if (!UUID.test(id)) throw new UserError("unknown account");
    const pool = getPool();
    const removed = await removePromoAccount(pool, id, new Date());
    if (removed) await writeSettingsAudit(pool, "promo account removed from the always-ignore list");
    return removed ? "Removed from the list" : "Already removed";
  });
}

/**
 * "Log out everywhere": every session is revoked (every device, this one too), an audit row first, then the
 * cookie is cleared and it's back to /login. Passkeys stay, so he signs straight back in with his own device;
 * the full lost-phone revoke (passkeys + push devices) stays a server command: `pnpm auth:revoke-all`.
 */
export async function logoutEverywhereAction(): Promise<void> {
  await requireSession();
  const pool = getPool();
  await writeSettingsAudit(pool, "logged out everywhere: every session revoked", "web");
  await getAuthStore().revokeAllSessions(new Date());
  await clearSessionCookie();
  redirect("/login");
}
