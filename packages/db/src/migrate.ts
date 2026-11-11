import { readdirSync, readFileSync } from "node:fs";

/** The slice of pg.Pool this needs — kept minimal so tests can pass a fake. */
export interface MigratablePool {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  connect(): Promise<{
    query(sql: string, params?: unknown[]): Promise<unknown>;
    release(): void;
  }>;
}

/** Applies any .sql files in `dir` not yet recorded in schema_migrations, in filename order. */
export async function migrate(pool: MigratablePool, dir: string): Promise<string[]> {
  await pool.query(
    "create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())",
  );
  const applied: string[] = [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const { rows } = await pool.query("select 1 from schema_migrations where id = $1", [file]);
    if (rows.length) continue;
    const sql = readFileSync(`${dir}/${file}`, "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (id) values ($1)", [file]);
      await client.query("commit");
      applied.push(file);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}
