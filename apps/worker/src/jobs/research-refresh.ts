import {
  aiNotesEnabled,
  blocklistFromEnv,
  createAnthropicNoteWriter,
  fetchCreatorSnapshot,
  loadResearchSettings,
  researchNeverRan,
  runResearchRefresh,
  RESEARCH_REFRESH_CRON,
  type RefreshResult,
} from "@autopilot/research";
import type { OutboxPool } from "./outbox.js";
import type { BossLike } from "./register-engagement.js";

/**
 * research-refresh (decisions.md §4 addendum 2026-11-16): ideas and hooks arrive by themselves every
 * 3 days, plus once at worker start if it never ran. Read-only on Instagram (Business Discovery GETs)
 * and writes only our own tables, so it runs in dry-run too, like analytics-ingest. With no Instagram
 * credentials it still adds niche ideas and the bundled yap scripts (the run note says so).
 * AI notes only when the setting research.aiNotes is on AND RESEARCH_AI_NOTES=1 AND an API key exists.
 * Tokens never reach a log line: errors are sanitised in the pipeline; URLs are never logged.
 */
export const RESEARCH_REFRESH_QUEUE = "research-refresh"; // own name here: queue.ts is outside this change

export interface ResearchEnv {
  /** META_ACCESS_TOKEN + IG_USER_ID (Facebook Login token; decisions.md #6). */
  instagram?: { accessToken: string; igUserId: string; graphVersion: string };
  anthropicKey?: string;
  aiNotesEnv: boolean;
  blocklist: string[];
}

export function researchEnvFromEnv(env: NodeJS.ProcessEnv = process.env): ResearchEnv {
  const out: ResearchEnv = { aiNotesEnv: env.RESEARCH_AI_NOTES === "1", blocklist: blocklistFromEnv(env) };
  if (env.META_ACCESS_TOKEN && env.IG_USER_ID && /^\d+$/.test(env.IG_USER_ID)) {
    out.instagram = { accessToken: env.META_ACCESS_TOKEN, igUserId: env.IG_USER_ID, graphVersion: env.META_GRAPH_VERSION || "v25.0" };
  }
  if (env.ANTHROPIC_API_KEY?.trim()) out.anthropicKey = env.ANTHROPIC_API_KEY.trim();
  return out;
}

export async function runResearchRefreshJob(
  pool: OutboxPool,
  cfg: ResearchEnv,
  opts: { now?: Date; log?: (l: string) => void; fetchImpl?: typeof fetch } = {},
): Promise<RefreshResult> {
  const log = opts.log ?? console.log;
  const settings = await loadResearchSettings(pool);
  const ig = cfg.instagram;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discover = ig
    ? (c: Parameters<typeof fetchCreatorSnapshot>[0]) =>
        fetchCreatorSnapshot(c, { igUserId: ig.igUserId, accessToken: ig.accessToken, graphVersion: ig.graphVersion, fetch: (u, init) => fetchImpl(u, init) })
    : null;
  const ai = aiNotesEnabled(settings, { RESEARCH_AI_NOTES: cfg.aiNotesEnv ? "1" : undefined }) && !!cfg.anthropicKey;
  return runResearchRefresh(pool, {
    discover,
    noteWriter: ai ? createAnthropicNoteWriter({ apiKey: cfg.anthropicKey! }) : null,
    aiMonthlyTokens: settings.aiMonthlyTokens,
    blocklist: cfg.blocklist,
    now: opts.now,
    log,
  });
}

export function researchStartupLine(cfg: ResearchEnv): string {
  return `research=read-only · discovery=${cfg.instagram ? "instagram" : "none (niche + scripts only)"} · ai notes env=${cfg.aiNotesEnv ? "on" : "off"} · cron=${RESEARCH_REFRESH_CRON}`;
}

export async function registerResearchRefreshJob(boss: BossLike & { send?(name: string, data?: object): Promise<unknown> }, pool: OutboxPool, cfg: ResearchEnv): Promise<void> {
  await boss.createQueue(RESEARCH_REFRESH_QUEUE);
  await boss.work(RESEARCH_REFRESH_QUEUE, async () => {
    await runResearchRefreshJob(pool, cfg);
  });
  await boss.schedule(RESEARCH_REFRESH_QUEUE, RESEARCH_REFRESH_CRON);
  // Once at start if it never ran (fresh server): the schedule alone could be up to 3 days away.
  if (boss.send && (await researchNeverRan(pool))) await boss.send(RESEARCH_REFRESH_QUEUE, {});
}
