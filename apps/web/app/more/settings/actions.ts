"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "../../../lib/db.js";
import { requireSession } from "../../../lib/auth/require.js";
import { parseCapsForm, updateCaps } from "../../../lib/settings/caps.js";

const PATH = "/more/settings";

/** Form fields: cap-<platform> (whole numbers, 0..CAP_LIMITS). Merges into the 'cadence' row and writes the audit alert. */
export async function saveCapsAction(fd: FormData): Promise<void> {
  await requireSession();
  let q = "";
  try {
    const parsed = parseCapsForm((k) => (fd.has(k) ? String(fd.get(k)) : null));
    if (!parsed.ok) q = `?error=${encodeURIComponent(parsed.error)}`;
    else {
      const { message } = await updateCaps(getPool(), parsed.caps);
      q = `?note=${encodeURIComponent(message ? `saved: ${message}` : "nothing changed")}`;
    }
  } catch (err) {
    const e = err as Error;
    console.error(`settings action failed: ${e.name}`);
    q = `?error=${encodeURIComponent(e instanceof RangeError ? e.message : "couldn't save, nothing changed")}`;
  }
  revalidatePath(PATH);
  redirect(`${PATH}${q}`);
}
