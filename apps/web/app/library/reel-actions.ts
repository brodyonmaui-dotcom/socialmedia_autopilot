"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { r2StorageFromEnv } from "@autopilot/media/src/storage.js";
import { blocklistFromEnv } from "@autopilot/research";
import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";
import { addSound, archiveSound, reelRequestFromForm, requestReel } from "../../lib/reels/data.js";

/**
 * Reel maker + sounds server actions (F20 E). Every one needs a session; DB/storage errors become a fixed
 * message (never echoed). None of them publishes or deletes: a sound upload adds a private R2 object + a row,
 * archive sets archived_at, and "Make the reel" queues work for the worker (which only ever adds a DRAFT).
 * Each redirects back with the result in the URL, so a refresh never re-sends the form.
 */

const note = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params).toString()}`;

/** Upload one mp3/m4a/wav (≤ 15 MB) to R2 `sounds/<sha256>.<ext>` (form fields `file`, optional `name`). */
export async function uploadSoundForm(formData: FormData): Promise<void> {
  await requireSession();
  const file = formData.get("file");
  let to: string;
  if (!(file instanceof File) || file.size === 0) {
    to = note("/library/sounds", { error: "Pick a file to upload." });
  } else {
    try {
      const storage = r2StorageFromEnv(process.env);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const r = await addSound(getPool(), { fileName: file.name, bytes, name: String(formData.get("name") ?? "") }, storage ? (k, b, t) => storage.putBytes(k, b, t) : null);
      to = r.ok ? note("/library/sounds", { done: r.already ? "already" : "added" }) : note("/library/sounds", { error: r.reason });
    } catch (err) {
      console.error(`sounds upload failed: ${(err as Error).name}`);
      to = note("/library/sounds", { error: "The upload failed. Try again." });
    }
  }
  revalidatePath("/library/sounds");
  redirect(to);
}

/** Archive one sound (form field `soundId`). */
export async function archiveSoundForm(formData: FormData): Promise<void> {
  await requireSession();
  let to: string;
  try {
    const r = await archiveSound(getPool(), String(formData.get("soundId") ?? ""));
    to = note("/library/sounds", r.ok ? { done: "archived" } : { error: "That sound was already archived." });
  } catch (err) {
    console.error(`sounds archive failed: ${(err as Error).name}`);
    to = note("/library/sounds", { error: "Something went wrong." });
  }
  revalidatePath("/library/sounds");
  redirect(to);
}

/** What the Make-a-reel form shows after a refused submit: the reason and the fields as sent (so nothing typed is lost). */
export interface ReelFormState {
  error: string | null;
  values: Record<string, string>;
  /** Bumped per submit so the form re-mounts with `values` as its defaults. */
  n: number;
}

const FORM_FIELDS = ["mediaId", "soundId", "audio", "trimStartS", "trimEndS", "soundVolume", "originalVolume", "caption"] as const;

/** "Make the reel" (useActionState): validates (length, volumes, sound, caption lint) and queues one media_edits row. */
export async function makeReelAction(prev: ReelFormState, formData: FormData): Promise<ReelFormState> {
  await requireSession();
  const req = reelRequestFromForm(formData);
  const values = Object.fromEntries(FORM_FIELDS.map((k) => [k, String(formData.get(k) ?? "").slice(0, 2400)]));
  let error: string | null = null;
  try {
    const r = await requestReel(getPool(), req, { blocklist: blocklistFromEnv(process.env) });
    if (!r.ok) error = r.reason;
  } catch (err) {
    console.error(`reel request failed: ${(err as Error).name}`);
    error = "Something went wrong.";
  }
  if (error === null) {
    revalidatePath("/library/reels");
    redirect("/library/reels?done=queued");
  }
  return { error, values, n: (prev?.n ?? 0) + 1 };
}
