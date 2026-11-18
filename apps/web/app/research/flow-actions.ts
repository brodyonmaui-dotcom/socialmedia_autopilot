"use server";

/**
 * v3 Research screen flow: thin wrappers that run the existing actions in ./actions.ts unchanged and then
 * close the URL-driven Dialog (?add=, ?move=, ?remove=) with a short ?note=. On a validation error the
 * wrapped action has already redirected with ?error= (that redirect propagates), so nothing here runs; the
 * add forms' error redirect also reopens the form with the typed text (draft_…, see lib/research/cards.ts).
 */
import { redirect } from "next/navigation";
import { requireSession } from "../../lib/auth/require.js";
import { safeReturn, withNote } from "../../lib/research/cards.js";
import { addCreatorAction, addHookAction, addIdeaAction, moveIdeaAction, removeCreatorAction } from "./actions.js";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function addIdeaFlowAction(fd: FormData): Promise<void> {
  await requireSession();
  await addIdeaAction(fd);
  redirect(withNote(safeReturn(str(fd, "return"), "/research"), "Idea added."));
}

export async function addHookFlowAction(fd: FormData): Promise<void> {
  await requireSession();
  await addHookAction(fd);
  redirect(withNote(safeReturn(str(fd, "return"), "/research/hooks"), "Hook added."));
}

export async function moveIdeaFlowAction(fd: FormData): Promise<void> {
  await requireSession();
  await moveIdeaAction(fd);
  redirect(withNote(safeReturn(str(fd, "return"), "/research"), `Moved to ${str(fd, "to") || "the next step"}.`));
}

export async function addCreatorFlowAction(fd: FormData): Promise<void> {
  await requireSession();
  await addCreatorAction(fd);
  const handle = str(fd, "handle").trim().replace(/^.*\//, "").replace(/^@+/, "").slice(0, 40);
  redirect(withNote("/research/creators", handle ? `Following @${handle}. New ideas from them come with the next refresh.` : "Creator added."));
}

export async function removeCreatorFlowAction(fd: FormData): Promise<void> {
  await requireSession();
  await removeCreatorAction(fd);
  const handle = str(fd, "handle").slice(0, 40);
  redirect(withNote("/research/creators", handle ? `Stopped following @${handle}. Their past ideas stay.` : "Creator removed."));
}
