import type { QueryPool } from "../store.js";
import { DEFAULT_AI_MONTHLY_TOKENS } from "./ai-notes.js";

/**
 * settings row 'research' = { aiNotes: boolean, aiMonthlyTokens: number }. aiNotes defaults OFF:
 * turning it on is budget-affecting, so it needs his OK in chat (CLAUDE.md #6), and the worker also
 * requires env RESEARCH_AI_NOTES=1.
 */
export const RESEARCH_SETTINGS_KEY = "research";
export interface ResearchSettings {
  aiNotes: boolean;
  aiMonthlyTokens: number;
}
export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = { aiNotes: false, aiMonthlyTokens: DEFAULT_AI_MONTHLY_TOKENS };

export function parseResearchSettings(value: unknown): ResearchSettings {
  const v = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const tokens = typeof v.aiMonthlyTokens === "number" && Number.isFinite(v.aiMonthlyTokens) && v.aiMonthlyTokens >= 0 ? Math.floor(v.aiMonthlyTokens) : DEFAULT_AI_MONTHLY_TOKENS;
  return { aiNotes: v.aiNotes === true, aiMonthlyTokens: tokens };
}

export async function loadResearchSettings(pool: QueryPool): Promise<ResearchSettings> {
  const { rows } = await pool.query("select value from settings where key = $1", [RESEARCH_SETTINGS_KEY]);
  return parseResearchSettings(rows[0]?.value);
}

/** Both switches: the setting (his OK) and the server env. */
export const aiNotesEnabled = (s: ResearchSettings, env: Record<string, string | undefined>) => s.aiNotes && env.RESEARCH_AI_NOTES === "1";
