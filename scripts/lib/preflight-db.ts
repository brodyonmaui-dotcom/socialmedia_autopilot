// Preflight DB read (F13 T1): one client, a read-only transaction, the single PREFLIGHT_SQL statement,
// rollback. Any error (unreachable, auth, missing table) → null, which the checks report as FAIL lines.
// The error itself is never printed: pg messages can echo parts of the connection string.
import { createPool } from "../../packages/db/src/client.js";
import { dbFactsFromJson, PREFLIGHT_SQL, type DbFacts } from "./preflight.js";

/** Anything with pg's query method (a pg.Client in a test transaction, or a pool client). */
export interface PreflightQueryable {
  query(sql: string): Promise<{ rows: any[] }>;
}

export async function queryDbFacts(c: PreflightQueryable): Promise<DbFacts> {
  const { rows } = await c.query(PREFLIGHT_SQL);
  return dbFactsFromJson(rows[0]?.facts);
}

export async function readDbFacts(databaseUrl: string, timeoutMs = 5000): Promise<DbFacts | null> {
  let pool: ReturnType<typeof createPool> | null = null;
  try {
    pool = createPool(databaseUrl);
    pool.on("error", () => {});
    const p = pool;
    const work = (async () => {
      const client = await p.connect();
      try {
        await client.query("begin transaction read only");
        const facts = await queryDbFacts(client);
        await client.query("rollback");
        return facts;
      } finally {
        client.release();
      }
    })();
    work.catch(() => {}); // if the timer wins, a late rejection must not surface as unhandled
    const timer = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs).unref());
    return await Promise.race([work, timer]);
  } catch {
    return null;
  } finally {
    void pool?.end().catch(() => {});
  }
}
