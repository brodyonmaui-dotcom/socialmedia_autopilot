import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrate, type MigratablePool } from "../migrate.js";

function fakePool() {
  const applied = new Set<string>();
  const queries: string[] = [];
  const pool: MigratablePool = {
    async query(sql, params) {
      queries.push(sql);
      if (sql.startsWith("select 1 from schema_migrations")) {
        return { rows: applied.has((params as string[])[0] ?? "") ? [{}] : [] };
      }
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql, params) {
          queries.push(sql);
          if (sql.startsWith("insert into schema_migrations")) applied.add((params as string[])[0] ?? "");
        },
        release() {},
      };
    },
  };
  return { pool, applied, queries };
}

describe("migrate", () => {
  const dir = fileURLToPath(new URL("./fixtures", import.meta.url));

  it("applies all migrations in filename order, once", async () => {
    const { pool, applied } = fakePool();
    const first = await migrate(pool, dir);
    expect(first).toEqual(["0001_a.sql", "0002_b.sql"]);
    expect(applied.has("0001_a.sql")).toBe(true);
    expect(applied.has("0002_b.sql")).toBe(true);

    const second = await migrate(pool, dir);
    expect(second).toEqual([]);
  });
});
