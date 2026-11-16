/**
 * Dev seed for "research that runs itself" (0013): runs the REAL research-refresh pipeline against the
 * fixture Business Discovery responses in packages/research/fixtures/business-discovery-demo.json for
 * three fake Instagram demo creators. Result: ~9 creator ideas with obviously-fake DEMO permalinks,
 * 3 niche ideas, the 20 yap-script ideas, their hooks, and a few items in the "Already used" archive.
 * No network, no AI (notes are code-written). Idempotent: skipped once a research_runs row exists.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fixtureDiscover, runResearchRefresh } from "../../../packages/research/src/index.js";

interface Pool {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/** demo_lifter_one is also in the base seed; the other two exist only for this demo. */
export const RESEARCH_DEMO_CREATORS = [
  { handle: "demo_lifter_one", pillar: "gym", notes: "DEMO: deadpan one-liners, short sets", followers: 48000 },
  { handle: "demo_trader_four", pillar: "trading", notes: "DEMO: process and psychology, no calls", followers: 21000 },
  { handle: "demo_mindset_five", pillar: "lifestyle", notes: "DEMO: routines and habits", followers: 9000 },
] as const;

/** Marked used so the "Already used" tab has something: the first two recorded scripts and one alt hook. */
export const RESEARCH_DEMO_USED = { ideas: ["yap-2026-11-16-#1", "yap-2026-11-16-#2", "ig-90000000000000103"], hooks: ["yap-2026-11-16-#1-alt"] };

export function loadDemoDiscoveryFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL("../../../packages/research/fixtures/business-discovery-demo.json", import.meta.url)), "utf8"));
}

export async function seedResearch(pool: Pool, now = new Date()): Promise<string> {
  for (const c of RESEARCH_DEMO_CREATORS) {
    await pool.query(
      "insert into creators (platform, handle, pillar, notes, followers) values ('instagram', $1, $2, $3, $4) on conflict (platform, handle) do nothing",
      [c.handle, c.pillar, c.notes, c.followers],
    );
  }
  const ran = (await pool.query("select count(*)::int n from research_runs")).rows[0].n as number;
  if (ran > 0) return `research already seeded (${ran} run(s))`;

  const res = await runResearchRefresh(pool, { discover: fixtureDiscover(loadDemoDiscoveryFixture()), now });
  const ideasUsed = (
    await pool.query("update ideas set used_at = coalesce(used_at, $2) where source_key = any($1::text[]) returning id", [RESEARCH_DEMO_USED.ideas, now.toISOString()])
  ).rows.length;
  const hooksUsed = (
    await pool.query("update hooks set used_at = coalesce(used_at, $2), times_used = greatest(times_used, 1) where source_key = any($1::text[]) returning id", [
      RESEARCH_DEMO_USED.hooks,
      now.toISOString(),
    ])
  ).rows.length;
  const i = res.ideasAdded;
  return `research ${res.status}: ${i.creator} creator ideas, ${i.niche} niche, ${i.script} scripts, ${res.hooksAdded} hooks, ${ideasUsed} ideas + ${hooksUsed} hook marked used`;
}
