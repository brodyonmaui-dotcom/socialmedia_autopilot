"use server";

import { redirect } from "next/navigation";
import { requireSession } from "../../lib/auth/require.js";
import { noteParams, safeBack, withNote } from "../../lib/library/screen.js";
import { dismissIssueAction, keepAllFixesAction, keepFixAction, keepOriginalAction, moveToFolderAction, requestFixAction } from "./actions.js";

/**
 * Form wrappers for the Library / Touch-up pages: each calls the matching server action in ./actions.ts
 * (which checks the session and does the work) and then redirects to `back` with the result in the URL, so
 * the page can show a note without client state and a refresh never re-sends the form. No logic of their own.
 */

const backOf = (fd: FormData) => safeBack(fd.get("back"));

export async function fixForm(formData: FormData): Promise<void> {
  await requireSession();
  const r = await requestFixAction(formData);
  redirect(withNote(backOf(formData), r.ok ? noteParams({ kind: "queued", queued: r.queued, already: r.already, skipped: r.skipped }) : noteParams({ kind: "error", reason: r.reason })));
}

export async function keepFixForm(formData: FormData): Promise<void> {
  await requireSession();
  const r = await keepFixAction(formData);
  redirect(withNote(backOf(formData), r.ok ? noteParams({ kind: "kept", repointed: r.repointed, stayed: r.stayed }) : noteParams({ kind: "error", reason: r.reason })));
}

export async function keepAllForm(formData: FormData): Promise<void> {
  await requireSession();
  const r = await keepAllFixesAction();
  redirect(withNote(backOf(formData), r.ok ? noteParams({ kind: "keptall", kept: r.kept, stayed: r.stayed, failed: r.failed, stillFixing: r.stillFixing, cantFix: r.cantFix }) : noteParams({ kind: "error", reason: r.reason })));
}

export async function keepOriginalForm(formData: FormData): Promise<void> {
  await requireSession();
  const r = await keepOriginalAction(formData);
  redirect(withNote(backOf(formData), r.ok ? noteParams({ kind: "original" }) : noteParams({ kind: "error", reason: r.reason })));
}

export async function dismissForm(formData: FormData): Promise<void> {
  await requireSession();
  const r = await dismissIssueAction(formData);
  redirect(withNote(backOf(formData), r.ok ? noteParams({ kind: "dismissed" }) : noteParams({ kind: "error", reason: r.reason })));
}

export async function moveFolderForm(formData: FormData): Promise<void> {
  await requireSession();
  const r = await moveToFolderAction(formData);
  redirect(withNote(backOf(formData), r.ok ? noteParams({ kind: "moved" }) : noteParams({ kind: "error", reason: r.reason })));
}
