"use server";

import { requireSession } from "../../lib/auth/require.js";
import { getPool } from "../../lib/db.js";
import { checkUploads, startUpload } from "../../lib/uploads/data.js";
import { uploadStorage } from "../../lib/uploads/env.js";

/**
 * Browser upload server actions (F23). Both need a session. Nothing here publishes or deletes: "check" only
 * reads, "start" opens one private R2 multipart upload + an 'uploading' row (basename + folder name only).
 */

/** Which picked files are already in (same basename + size, processed). */
export async function checkUploadsAction(files: { name: string; size: number }[]): Promise<{ name: string; size: number; already: boolean; mediaId?: string }[]> {
  await requireSession();
  // Before migration 0017 there's no uploads table: treat every file as new; start then explains.
  return checkUploads(getPool(), files).catch(() => files.map((f) => ({ name: f.name, size: f.size, already: false })));
}

/** Opens one upload; the client then PUTs parts of `partSize` bytes to /app/media/upload/<uploadId>/part/<n>. */
export async function startUploadAction(f: { name: string; size: number; type: string; relPath?: string }): Promise<{ ok: true; uploadId: string; partSize: number } | { ok: false; error: string }> {
  await requireSession();
  try {
    return await startUpload(getPool(), uploadStorage(), f ?? {});
  } catch (err) {
    console.error(`upload start failed: ${(err as Error).name}`);
    if ((err as { code?: string }).code === "42P01") return { ok: false, error: "Uploads aren't set up on the server yet: apply migration 0017 (docs/runbooks/uploads.md)." };
    return { ok: false, error: "Something went wrong. Try again." };
  }
}
