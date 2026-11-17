"use server";

import {
  addCreator,
  addHook,
  addIdea,
  blocklistFromEnv,
  isPillar,
  moveIdeaById,
  setCreatorActive,
  IDEA_STAGES,
  type IdeaStage,
} from "@autopilot/research";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "../../lib/db.js";
import { markHookUsed, markIdeaUsed, removeCreator } from "../../lib/research/ideas.js";
import { requireSession } from "../../lib/auth/require.js";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

/** Errors go back to the page as ?error=… so the phone shows them inline (no client JS needed). */
async function run(path: string, fn: () => Promise<unknown>): Promise<void> {
  let error: string | undefined;
  try {
    await fn();
  } catch (err) {
    const e = err as Error;
    // Only our own validation messages reach the UI; anything else is generic (never leak DB errors).
    error = e.name === "ValidationError" || e.name === "BacklogError" ? e.message : "something went wrong";
  }
  revalidatePath(path);
  if (error) redirect(`${path}?error=${encodeURIComponent(error)}`);
}

export async function addCreatorAction(fd: FormData): Promise<void> {
  await requireSession();
  const followersRaw = str(fd, "followers").replace(/[,\s]/g, "");
  await run("/research/creators", () =>
    addCreator(
      getPool(),
      {
        platform: str(fd, "platform"),
        handle: str(fd, "handle"),
        pillar: str(fd, "pillar") || null,
        notes: str(fd, "notes"),
        followers: followersRaw ? Number(followersRaw) : null,
      },
      blocklistFromEnv(),
    ),
  );
}

export async function toggleCreatorAction(fd: FormData): Promise<void> {
  await requireSession();
  await run("/research/creators", () => setCreatorActive(getPool(), str(fd, "id"), str(fd, "active") === "true"));
}

export async function addIdeaAction(fd: FormData): Promise<void> {
  await requireSession();
  await run("/research/ideas", () =>
    addIdea(
      getPool(),
      { title: str(fd, "title"), pillar: str(fd, "pillar") || null, hook: str(fd, "hook"), sourceCreatorId: str(fd, "sourceCreatorId") || null },
      blocklistFromEnv(),
    ),
  );
}

export async function moveIdeaAction(fd: FormData): Promise<void> {
  await requireSession();
  const to = str(fd, "to");
  await run("/research/ideas", async () => {
    if (!(IDEA_STAGES as readonly string[]).includes(to)) throw Object.assign(new Error("unknown stage"), { name: "ValidationError" });
    const batchItems = str(fd, "batchItemIds")
      .split(/[\s,]+/)
      .filter(Boolean);
    await moveIdeaById(
      getPool(),
      str(fd, "id"),
      to as IdeaStage,
      {
        script: str(fd, "script") || undefined,
        mediaId: str(fd, "mediaId") || undefined,
        batchItemIds: batchItems.length ? batchItems : undefined,
      },
      blocklistFromEnv(),
    );
  });
}

export async function addHookAction(fd: FormData): Promise<void> {
  await requireSession();
  const pillar = str(fd, "pillar");
  await run("/research/hooks", () =>
    addHook(
      getPool(),
      { text: str(fd, "text"), pillar: isPillar(pillar) ? pillar : null, source: str(fd, "source") === "creator" ? "creator" : "own" },
      blocklistFromEnv(),
    ),
  );
}

// ---------- 0013: research that runs itself ----------
const notFound = () => Object.assign(new Error("not found; reload"), { name: "ValidationError" });
/** Forms post used=true|false; the redirect target is the page they came from (default /research/ideas). */
const backTo = (fd: FormData, fallback: string) => {
  const p = str(fd, "back");
  return /^\/research(\/[a-z-]+)?$/.test(p) ? p : fallback;
};

/** The "Used" checkbox on an idea: used=true → Already used archive, used=false → back to Ideas. */
export async function markIdeaUsedAction(fd: FormData): Promise<void> {
  await requireSession();
  await run(backTo(fd, "/research/ideas"), async () => {
    if (!(await markIdeaUsed(getPool(), str(fd, "id"), str(fd, "used") === "true"))) throw notFound();
  });
}

export async function markHookUsedAction(fd: FormData): Promise<void> {
  await requireSession();
  await run(backTo(fd, "/research/hooks"), async () => {
    if (!(await markHookUsed(getPool(), str(fd, "id"), str(fd, "used") === "true"))) throw notFound();
  });
}

/** Remove = set inactive (kept for history, never deleted); re-adding the handle re-activates it. */
export async function removeCreatorAction(fd: FormData): Promise<void> {
  await requireSession();
  await run("/research/creators", () => removeCreator(getPool(), str(fd, "id")));
}
