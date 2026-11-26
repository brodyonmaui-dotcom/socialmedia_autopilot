"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "../../lib/auth/require.js";
import { creatorZone } from "../../lib/calendar/load.js";
import { getPool } from "../../lib/db.js";
import { parsePlatforms, type ClipText } from "../../lib/library/add-to-calendar.js";
import { approveAndSchedule, scheduleNote } from "../../lib/library/approve-and-schedule.js";
import { isUuid } from "../../lib/library/data.js";

/**
 * "Ready to post" form. Fields: mediaId (repeated), platform (repeated), caption:<mediaId>, title:<mediaId>, intent = "approve" | "draft".
 * "approve" = drafts at the next open slots, then the normal approve path (block warnings stay drafts). "draft" = drafts only.
 * The confirm dialog's times come from previewAddToCalendarAction (library/actions.ts). Always redirects back to the upload page with a note.
 */
export async function approveAndScheduleAction(fd: FormData): Promise<void> {
  const session = await requireSession();
  const ids = [...new Set(fd.getAll("mediaId").map(String).filter(isUuid))];
  const platforms = parsePlatforms(fd.getAll("platform").map(String));
  const approve = String(fd.get("intent") ?? "approve") !== "draft";
  let to = "/library/upload";
  if (ids.length === 0) to += `?error=${encodeURIComponent("Pick at least one clip.")}`;
  else if (platforms.length === 0) to += `?error=${encodeURIComponent("Pick at least one platform.")}`;
  else {
    const overrides: Record<string, ClipText> = {};
    for (const id of ids) {
      const caption = fd.get(`caption:${id}`);
      const title = fd.get(`title:${id}`);
      overrides[id] = { ...(typeof caption === "string" ? { caption: caption.slice(0, 2200) } : {}), ...(typeof title === "string" ? { title: title.slice(0, 100) } : {}) };
    }
    try {
      const r = await approveAndSchedule(getPool(), { mediaIds: ids, platforms, overrides, now: new Date(), timeZone: creatorZone().timeZone, sessionId: session.id, approve });
      to += `?note=${encodeURIComponent(scheduleNote(r, approve))}`;
    } catch (err) {
      console.error(`ready approve-and-schedule failed: ${(err as Error).name}`);
      to += `?error=${encodeURIComponent("Something went wrong. Check the calendar before trying again.")}`;
    }
  }
  revalidatePath("/library/upload");
  revalidatePath("/calendar");
  revalidatePath("/", "layout");
  redirect(to);
}
