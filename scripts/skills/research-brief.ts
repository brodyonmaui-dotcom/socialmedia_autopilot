// research-brief skill: tracked creators' recent posts → ranked hooks + patterns (markdown in logs/).
//   pnpm skill:research-brief --fixture packages/research/fixtures/research-sample.json [--days 14]
//   pnpm skill:research-brief            (creators from the DB; Instagram ones fetched live via Business
//                                         Discovery: needs META_ACCESS_TOKEN + IG_USER_ID, read-only GETs)
// Prints one line. Read-only: never writes to the DB or any platform.
import { readFileSync } from "node:fs";
import { blocklistFromEnv, buildResearchBrief, fetchCreatorSnapshot, listCreators, type Creator, type CreatorSnapshot } from "../../packages/research/src/index.js";
import { arg, loadEnv, writeLog } from "./lib/io.js";

loadEnv();
const argv = process.argv.slice(2);
const fixture = arg(argv, "fixture");
const windowDays = Number(arg(argv, "days") ?? 14);

let creators: Creator[];
let snapshots: CreatorSnapshot[];
const skipped: string[] = [];
try {
  if (fixture) {
    ({ creators, snapshots } = JSON.parse(readFileSync(fixture, "utf8")));
  } else {
    if (!process.env.DATABASE_URL) throw new Error("no --fixture and DATABASE_URL is not set");
    const { createPool } = await import("../../packages/db/src/client.js");
    const pool = createPool(process.env.DATABASE_URL);
    creators = (await listCreators(pool)).filter((c) => c.active);
    await pool.end();
    const token = process.env.META_ACCESS_TOKEN;
    const igUserId = process.env.IG_USER_ID;
    if (!token || !igUserId) throw new Error("META_ACCESS_TOKEN / IG_USER_ID not set (needed for Business Discovery)");
    const cfg = { igUserId, accessToken: token, graphVersion: process.env.META_GRAPH_VERSION || undefined, fetch: (url: string, init: { headers: Record<string, string> }) => fetch(url, init) };
    snapshots = [];
    for (const c of creators.filter((c) => c.platform === "instagram")) {
      try {
        snapshots.push(await fetchCreatorSnapshot(c, cfg));
      } catch (e) {
        skipped.push(`${c.handle}: ${(e as Error).message}`); // one bad creator doesn't sink the brief
      }
    }
  }
  const now = fixture && arg(argv, "now") ? new Date(arg(argv, "now")!) : new Date();
  const brief = buildResearchBrief(creators, snapshots, { now, windowDays, blocklist: blocklistFromEnv() });
  const path = writeLog("research-brief", brief.markdown, now);
  console.log(
    `research-brief: OK ${brief.creatorsCovered} creator(s), ${brief.postsConsidered} post(s), ${brief.topPosts.length} top hook(s), ${brief.droppedForPrivacy} dropped for privacy${skipped.length ? `, ${skipped.length} creator(s) skipped (fetch failed)` : ""} → ${path}`,
  );
} catch (err) {
  console.log(`research-brief: FAIL ${(err as Error).message}`);
  process.exit(1);
}
