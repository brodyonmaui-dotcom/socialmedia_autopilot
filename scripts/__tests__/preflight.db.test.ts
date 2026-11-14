import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../../packages/db/src/client.js";
import { queryDbFacts } from "../lib/preflight-db.js";
import { runChecks, type PreflightInput } from "../lib/preflight.js";

// F13 T1 scratch-DB test: the preflight's own query is read-only (it runs in a read-only transaction
// here). Only the "one passkey" case adds a row, inside a transaction that is always rolled back.
const MIGRATIONS = ["0001_init.sql", "0002_settings.sql", "0003_research.sql", "0004_analytics.sql", "0005_outbox.sql", "0006_auth_approval.sql", "0007_engagement.sql", "0008_alerts_push.sql"];
const NOW = new Date("2026-11-14T12:00:00Z");

describe.skipIf(!process.env.DATABASE_URL)("preflight DB facts (dev DB, rolled back)", () => {
  const pool = createPool(process.env.DATABASE_URL ?? "");
  let client: { query(sql: string): Promise<{ rows: any[] }>; release(): void };

  beforeAll(async () => {
    client = await pool.connect();
  });
  afterAll(async () => {
    client.release();
    await pool.end();
  });

  const passkeyCheck = async () => {
    const facts = await queryDbFacts(client);
    const input: PreflightInput = {
      env: {},
      appliedMigrations: facts.appliedMigrations,
      expectedMigrations: MIGRATIONS,
      passkeyCount: facts.passkeyCount,
      settings: facts.settings,
      lastBackupAt: null,
      researchLog: "",
      now: NOW,
    };
    return { facts, check: runChecks(input).find((r) => r.id === "passkey")! };
  };

  it("the facts query runs in a read-only transaction and matches a direct count", async () => {
    await client.query("begin transaction read only");
    try {
      const direct = await client.query("select count(*)::int as n from auth_credentials where revoked_at is null");
      const { facts, check } = await passkeyCheck();
      expect(facts.passkeyCount).toBe(direct.rows[0].n);
      expect(check.status).toBe(direct.rows[0].n > 0 ? "PASS" : "FAIL");
      expect(facts.appliedMigrations.length).toBeGreaterThan(0);
    } finally {
      await client.query("rollback");
    }
  });

  it("zero passkeys FAILs, one passes, a revoked one doesn't count (rolled back)", async () => {
    await client.query("begin");
    try {
      await client.query("delete from auth_credentials");
      expect((await passkeyCheck()).check.status).toBe("FAIL");
      await client.query("insert into auth_credentials (credential_id, public_key) values ('preflight-test', '\\x00')");
      expect((await passkeyCheck()).check.status).toBe("PASS");
      await client.query("update auth_credentials set revoked_at = now() where credential_id = 'preflight-test'");
      expect((await passkeyCheck()).check.status).toBe("FAIL");
    } finally {
      await client.query("rollback");
    }
  });
});
