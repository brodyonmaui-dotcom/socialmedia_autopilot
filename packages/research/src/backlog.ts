import type { Idea, IdeaStage } from "./types.js";

/**
 * Allowed stage moves. Forward one step at a time, back one step (fixing a mistake), drop from
 * anything not yet posted, and revive a dropped idea back to "idea". "posted" is terminal: once
 * something is public, the backlog entry is history and never moves again.
 */
const MOVES: Record<IdeaStage, readonly IdeaStage[]> = {
  idea: ["scripted", "dropped"],
  scripted: ["filmed", "idea", "dropped"],
  filmed: ["posted", "scripted", "dropped"],
  posted: [],
  dropped: ["idea"],
};

export class BacklogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacklogError";
  }
}

export function allowedMoves(stage: IdeaStage): readonly IdeaStage[] {
  return MOVES[stage];
}

export interface MovePatch {
  script?: string;
  hook?: string;
  mediaId?: string;
  batchItemIds?: string[];
}

/**
 * Returns the idea moved to `to`, with `patch` applied. Throws BacklogError on an illegal move
 * or when the target stage's requirement is missing:
 * - scripted needs a non-empty script,
 * - filmed needs a library clip (mediaId),
 * - posted needs at least one batch item (it went out through an approved batch, never around it).
 */
export function moveIdea(idea: Idea, to: IdeaStage, patch: MovePatch = {}, now = new Date()): Idea {
  if (!MOVES[idea.stage].includes(to)) {
    throw new BacklogError(`can't move "${idea.title}" from ${idea.stage} to ${to}`);
  }
  const next: Idea = {
    ...idea,
    script: patch.script ?? idea.script,
    hook: patch.hook ?? idea.hook,
    mediaId: patch.mediaId ?? idea.mediaId,
    batchItemIds: patch.batchItemIds ?? idea.batchItemIds,
    stage: to,
    updatedAt: now.toISOString(),
  };
  if (to === "scripted" && !next.script.trim()) throw new BacklogError("a script is required to mark an idea scripted");
  if (to === "filmed" && !next.mediaId) throw new BacklogError("link the library clip to mark an idea filmed");
  if (to === "posted" && next.batchItemIds.length === 0) {
    throw new BacklogError("an idea is posted only through an approved batch item");
  }
  return next;
}

/** Counts per stage, every stage present (0 when empty) so the UI can render a stable header. */
export function stageCounts(ideas: Idea[]): Record<IdeaStage, number> {
  const counts: Record<IdeaStage, number> = { idea: 0, scripted: 0, filmed: 0, posted: 0, dropped: 0 };
  for (const i of ideas) counts[i.stage]++;
  return counts;
}

/**
 * What to film next: scripted ideas, oldest first, then raw ideas that already have a hook.
 * Simple and predictable on purpose; ranking by performance is the weekly report's job.
 */
export function filmNext(ideas: Idea[], limit = 5): Idea[] {
  const byAge = (a: Idea, b: Idea) => a.createdAt.localeCompare(b.createdAt);
  const scripted = ideas.filter((i) => i.stage === "scripted").sort(byAge);
  const hooked = ideas.filter((i) => i.stage === "idea" && i.hook.trim()).sort(byAge);
  return [...scripted, ...hooked].slice(0, limit);
}
