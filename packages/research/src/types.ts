import type { Platform } from "@autopilot/core";

/** Content pillars from docs/voice.md ("Defaults by content type"). */
export const PILLARS = ["gym", "trading", "meal", "lifestyle", "tip", "running"] as const;
export type Pillar = (typeof PILLARS)[number];

/**
 * A creator we learn from. Tracked by public handle only; numbers come from Business Discovery
 * (Instagram, Facebook Login — decisions.md #6) or manual paste for other platforms.
 */
export interface Creator {
  id: string;
  platform: Platform;
  /** Public handle without the leading "@". */
  handle: string;
  pillar: Pillar | null;
  /** Why we follow them ("great hooks on trading recaps"). Never their whereabouts. */
  notes: string;
  followers: number | null;
  /** false = paused (kept for history, skipped by research-brief). */
  active: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
}

/** The backlog pipeline: idea → scripted → filmed → posted, or dropped. */
export const IDEA_STAGES = ["idea", "scripted", "filmed", "posted", "dropped"] as const;
export type IdeaStage = (typeof IDEA_STAGES)[number];

export interface Idea {
  id: string;
  title: string;
  pillar: Pillar | null;
  stage: IdeaStage;
  /** The opening line / on-screen hook. */
  hook: string;
  /** Shot list or talking points; required to reach "scripted". */
  script: string;
  /** Where the idea came from (a tracked creator), if anywhere. */
  sourceCreatorId: string | null;
  /** The library clip that realizes it; required to reach "filmed". */
  mediaId: string | null;
  /** batch_items rows it went out as; at least one is required to reach "posted". */
  batchItemIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** A reusable opening line, kept separately so hooks can be ranked and recycled across ideas. */
export interface Hook {
  id: string;
  text: string;
  pillar: Pillar | null;
  /** "own" = he wrote/used it, "creator" = adapted from a tracked creator's pattern. */
  source: "own" | "creator";
  sourceCreatorId: string | null;
  timesUsed: number;
  createdAt: string;
}

export function isPillar(value: unknown): value is Pillar {
  return typeof value === "string" && (PILLARS as readonly string[]).includes(value);
}
