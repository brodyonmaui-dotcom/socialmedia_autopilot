import { syntheticPosts } from "../../../packages/analytics/src/index.js";

/**
 * Dev seed: demo research + analytics rows for a LOCAL Postgres, so the /research and
 * /analytics pages can be checked without the server. Pure helpers here; the CLI is
 * scripts/dev/seed.ts.
 */

export const DEMO_HASH_PREFIX = "demo-";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Throws unless the URL points at this machine. Necessary but NOT sufficient: on the laptop,
 * localhost:5433 is the SSH tunnel to the production DB. The CLI also runs
 * `assertNoRealData` against the live connection before writing anything.
 */
export function assertLocalDatabaseUrl(url: string | undefined): URL {
  if (!url) throw new Error("dev:seed: set DEV_DATABASE_URL (or DATABASE_URL) to a local Postgres");
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("dev:seed: database URL doesn't parse");
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("dev:seed: not a postgres URL");
  if (!LOCAL_HOSTS.has(u.hostname)) throw new Error(`dev:seed: refusing non-local host (${u.hostname === "" ? "empty" : "remote"}). Local Postgres only.`);
  return u;
}

/** Throws if the target already holds real (non-demo) media: that's a real library, maybe production through a tunnel. */
export function assertNoRealData(realMediaRows: number): void {
  if (realMediaRows > 0) {
    throw new Error(
      `dev:seed: refusing, the target has ${realMediaRows} real media row(s). This looks like a real library ` +
        "(on the laptop, localhost:5433 is the tunnel to production). Point DEV_DATABASE_URL at an empty local database.",
    );
  }
}

export interface SeedRows {
  media: Array<{ hash: string; pillar: string; durationS: number }>;
  items: Array<{ hash: string; platform: string; caption: string; scheduledFor: string; trial: object | null; metrics: object }>;
  creators: Array<{ platform: string; handle: string; pillar: string; notes: string; followers: number }>;
  ideas: Array<{ title: string; pillar: string; stage: string; hook: string }>;
  hooks: Array<{ text: string; pillar: string; source: "own" | "creator" }>;
}

/** Deterministic demo rows: 4 weeks of synthetic posts (packages/analytics seed) + a small research set. Invented, never real. */
export function buildSeedRows(weekStart: string): SeedRows {
  const posts = syntheticPosts({ weekStart, weeks: 4 });
  const media: SeedRows["media"] = [];
  const items: SeedRows["items"] = [];
  // One media row per (day, slot): the 3 platform posts of a slot share a clip.
  for (let i = 0; i < posts.length; i += 3) {
    const hash = `${DEMO_HASH_PREFIX}${String(i / 3 + 1).padStart(4, "0")}`;
    const p0 = posts[i]!;
    media.push({ hash, pillar: p0.pillar ?? "gym", durationS: p0.durationS ?? 30 });
    for (const p of posts.slice(i, i + 3)) {
      items.push({
        hash,
        platform: p.platform,
        caption: p.caption,
        scheduledFor: p.postedAt,
        trial: p.platform === "instagram" ? (p.isTrial ? { graduation_strategy: "MANUAL", ...(p.trialSharedAt ? { sharedAt: p.trialSharedAt } : {}) } : null) : null,
        metrics: p.metrics,
      });
    }
  }
  return {
    media,
    items,
    creators: [
      { platform: "instagram", handle: "demo_lifter_one", pillar: "gym", notes: "DEMO: deadpan one-liners, short sets", followers: 48000 },
      { platform: "tiktok", handle: "demo_trader_two", pillar: "trading", notes: "DEMO: honest daily recaps with real numbers", followers: 21000 },
      { platform: "youtube", handle: "demo_mealprep_three", pillar: "meal", notes: "DEMO: weekly prep, macros on screen", followers: 9000 },
    ],
    ideas: [
      { title: "DEMO: pull day, slow negatives only", pillar: "gym", stage: "idea", hook: "My lats are not a fan of this…" },
      { title: "DEMO: red day recap, no excuses", pillar: "trading", stage: "scripted", hook: "Welp, I was the liquidity today 🥀" },
      { title: "DEMO: Sunday prep in 60 seconds", pillar: "meal", stage: "filmed", hook: "Keeping it simple, high protein, and consistent." },
    ],
    hooks: [
      { text: "Most people don't need more back days. They need better reps.", pillar: "tip", source: "own" },
      { text: "Just stacking days is all…", pillar: "gym", source: "own" },
      { text: "Get shredded, not stiff", pillar: "tip", source: "creator" },
    ],
  };
}
