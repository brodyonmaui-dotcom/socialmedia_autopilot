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

// TODO(F2): every action below must check the single-user session once login lands.
// Until then the dashboard is only reachable behind Caddy on the private host (decisions.md).

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
  await run("/research/creators", () => setCreatorActive(getPool(), str(fd, "id"), str(fd, "active") === "true"));
}

export async function addIdeaAction(fd: FormData): Promise<void> {
  await run("/research/ideas", () =>
    addIdea(
      getPool(),
      { title: str(fd, "title"), pillar: str(fd, "pillar") || null, hook: str(fd, "hook"), sourceCreatorId: str(fd, "sourceCreatorId") || null },
      blocklistFromEnv(),
    ),
  );
}

export async function moveIdeaAction(fd: FormData): Promise<void> {
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
  const pillar = str(fd, "pillar");
  await run("/research/hooks", () =>
    addHook(
      getPool(),
      { text: str(fd, "text"), pillar: isPillar(pillar) ? pillar : null, source: str(fd, "source") === "creator" ? "creator" : "own" },
      blocklistFromEnv(),
    ),
  );
}
