// Screenshots only: creates a session in the LOCAL dev DB and prints `ap_session=<token>`.
// Usage: DATABASE_URL=postgres://…@localhost:5432/autopilot_dev pnpm dev:session
import { createPool } from "../../packages/db/src/index.js";
import { PgAuthStore } from "../../apps/web/lib/auth/pg-store.js";
import { createSession } from "../../apps/web/lib/auth/session.js";
import { assertDevSessionAllowed } from "./lib/dev-session.js";
import { assertNoRealData, DEMO_HASH_PREFIX } from "./lib/seed.js";

let url: string;
try {
  url = assertDevSessionAllowed(process.env);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const pool = createPool(url);
let exitCode = 0;
try {
  const hasMedia = (await pool.query("select to_regclass('public.media') is not null as ok")).rows[0].ok as boolean;
  if (hasMedia) {
    const real = (await pool.query("select count(*)::int n from media where content_hash not like $1", [`${DEMO_HASH_PREFIX}%`])).rows[0]
      .n as number;
    assertNoRealData(real);
  }
  const { token } = await createSession(new PgAuthStore(pool));
  console.log(`ap_session=${token}`);
} catch (err) {
  exitCode = 1;
  console.error(`dev:session: ${(err as Error).message}`);
} finally {
  await pool.end();
}
process.exit(exitCode);
