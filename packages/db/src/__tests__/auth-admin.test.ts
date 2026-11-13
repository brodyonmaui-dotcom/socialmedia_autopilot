import { describe, expect, it } from "vitest";
import {
  createEnrollCode,
  ENROLL_CODE_TTL_MS,
  newEnrollCode,
  normalizeEnrollCode,
  revokeAllAuth,
  sha256Hex,
  type Queryable,
} from "../auth-admin.js";

function recorder(rowCount = 0): Queryable & { calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rows: [], rowCount };
    },
  };
}

describe("auth-admin", () => {
  it("mints XXXX-XXXX codes from an unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = newEnrollCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it("normalizes case, spaces and dashes", () => {
    expect(normalizeEnrollCode(" abcd-ef 23 ")).toBe("ABCDEF23");
    expect(normalizeEnrollCode("ABCD - EF23")).toBe("ABCDEF23");
  });

  it("sha256Hex is hex sha256", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("inserts only the hash of the code, with a 15 min expiry", async () => {
    const db = recorder(1);
    const now = new Date("2026-01-01T00:00:00Z");
    const { code, expiresAt } = await createEnrollCode(db, now);
    expect(expiresAt.getTime() - now.getTime()).toBe(ENROLL_CODE_TTL_MS);
    expect(db.calls).toHaveLength(1);
    const call = db.calls[0]!;
    expect(call.sql).toMatch(/^insert into auth_enroll_codes/);
    expect(call.params).toContain(sha256Hex(normalizeEnrollCode(code)));
    const flat = JSON.stringify(call) ;
    expect(flat).not.toContain(code);
    expect(flat).not.toContain(normalizeEnrollCode(code));
  });

  it("revokeAllAuth updates sessions, credentials, codes, challenges and never deletes", async () => {
    const db = recorder(2);
    const res = await revokeAllAuth(db, new Date());
    expect(res).toEqual({ sessions: 2, credentials: 2 });
    const sqls = db.calls.map((c) => c.sql);
    expect(sqls.every((s) => s.startsWith("update "))).toBe(true);
    for (const t of ["auth_sessions", "auth_credentials", "auth_enroll_codes", "auth_challenges"]) {
      expect(sqls.some((s) => s.includes(t))).toBe(true);
    }
    expect(JSON.stringify(db.calls)).not.toMatch(/delete/i);
  });
});
