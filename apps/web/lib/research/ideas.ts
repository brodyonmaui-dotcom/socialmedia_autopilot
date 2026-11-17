/**
 * Research data layer for the /research pages (0013: research that runs itself). Thin wrappers over
 * @autopilot/research so the page designer has one import with stable types. Server-only (takes a pool).
 * Ideas arrive by themselves (worker job research-refresh, every 3 days); creators stay manual.
 */
import {
  addCreator as addCreatorRow,
  AI_NOTES_PURPOSE,
  aiTokensThisMonth,
  lastResearchRun,
  listCreators,
  listHookCards,
  listIdeaCards,
  loadResearchSettings,
  nextRefreshAt,
  researchCounts,
  setCreatorActive,
  setHookUsed,
  setIdeaUsed,
  type Creator,
  type HookCard,
  type IdeaCard,
  type IdeaSource,
  type NewCreator,
  type Pillar,
  type QueryPool,
  type ResearchCountsRow,
  type ResearchRunRow,
} from "@autopilot/research";

export type { Creator, HookCard, IdeaCard, IdeaSource, ResearchCountsRow, ResearchRunRow };
export type IdeasTab = "ideas" | "used";

export interface LoadIdeasOptions {
  tab: IdeasTab;
  pillar?: Pillar | null;
  source?: IdeaSource | null;
}

/** Ideas tab = not used yet (scripted first, then best score, newest); "used" = the Already used archive (latest first). */
export function loadIdeas(pool: QueryPool, opts: LoadIdeasOptions): Promise<IdeaCard[]> {
  return listIdeaCards(pool, { tab: opts.tab, pillar: opts.pillar ?? null, source: opts.source ?? null });
}

/** The "Used" checkbox: true moves it to Already used (keeps the first time on a double tap), false brings it back. */
export function markIdeaUsed(pool: QueryPool, id: string, used: boolean): Promise<IdeaCard | null> {
  return setIdeaUsed(pool, id, used);
}

/** used undefined = all; true = used ones; false = unused ones. */
export function loadHooks(pool: QueryPool, opts: { used?: boolean; pillar?: Pillar | null } = {}): Promise<HookCard[]> {
  return listHookCards(pool, opts);
}

export function markHookUsed(pool: QueryPool, id: string, used: boolean): Promise<HookCard | null> {
  return setHookUsed(pool, id, used);
}

export function loadCreators(pool: QueryPool): Promise<Creator[]> {
  return listCreators(pool);
}

/** Add (or re-activate) a tracked creator. Validates handle/pillar and lints notes for places. */
export function addCreator(pool: QueryPool, input: NewCreator, blocklist?: string[]): Promise<Creator> {
  return addCreatorRow(pool, input, blocklist);
}

/** "Remove" = set inactive (kept for history; never deleted). */
export function removeCreator(pool: QueryPool, id: string): Promise<void> {
  return setCreatorActive(pool, id, false);
}

export interface ResearchStatus {
  lastRun: ResearchRunRow | null;
  /** Next scheduled research-refresh (every 3 days, UTC cron). */
  nextRunAt: string;
  counts: ResearchCountsRow;
  aiNotes: {
    /** The research.aiNotes setting (default off). The worker also needs RESEARCH_AI_NOTES=1. */
    on: boolean;
    /** Turning it on is budget-affecting: show "Needs your OK in chat", no toggle. */
    needsOkInChat: true;
    monthlyBudgetTokens: number;
    tokensUsedThisMonth: number;
  };
}

export async function loadResearchStatus(pool: QueryPool, now = new Date()): Promise<ResearchStatus> {
  const [lastRun, counts, settings, used] = await Promise.all([lastResearchRun(pool), researchCounts(pool), loadResearchSettings(pool), aiTokensThisMonth(pool, AI_NOTES_PURPOSE, now)]);
  return {
    lastRun,
    nextRunAt: nextRefreshAt(now).toISOString(),
    counts,
    aiNotes: { on: settings.aiNotes, needsOkInChat: true, monthlyBudgetTokens: settings.aiMonthlyTokens, tokensUsedThisMonth: used },
  };
}
