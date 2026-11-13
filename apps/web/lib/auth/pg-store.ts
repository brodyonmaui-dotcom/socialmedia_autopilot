import { revokeAllAuth, type Queryable } from "@autopilot/db";
import type { AuthStore, Session, StoredCredential } from "./store.js";

interface SessionRow {
  id: string;
  created_at: Date;
  expires_at: Date;
  hard_expires_at: Date;
}

function toSession(r: SessionRow): Session {
  return { id: r.id, createdAt: r.created_at, expiresAt: r.expires_at, hardExpiresAt: r.hard_expires_at };
}

const SESSION_COLS = "id, created_at, expires_at, hard_expires_at";

export class PgAuthStore implements AuthStore {
  constructor(private db: Queryable) {}

  async insertSession(hash: string, expiresAt: Date, hardExpiresAt: Date, now: Date): Promise<Session> {
    const { rows } = await this.db.query(
      `insert into auth_sessions (token_hash, created_at, expires_at, hard_expires_at, last_seen_at)
       values ($1, $2, $3, $4, $2) returning ${SESSION_COLS}`,
      [hash, now, expiresAt, hardExpiresAt],
    );
    return toSession(rows[0] as SessionRow);
  }

  async findSession(hash: string, now: Date): Promise<Session | null> {
    const { rows } = await this.db.query(
      `select ${SESSION_COLS} from auth_sessions
       where token_hash = $1 and revoked_at is null and expires_at > $2 and hard_expires_at > $2`,
      [hash, now],
    );
    const row = rows[0] as SessionRow | undefined;
    return row ? toSession(row) : null;
  }

  async touchSession(id: string, expiresAt: Date, now: Date): Promise<void> {
    await this.db.query("update auth_sessions set expires_at = $2, last_seen_at = $3 where id = $1", [id, expiresAt, now]);
  }

  async revokeSession(id: string, now: Date): Promise<void> {
    await this.db.query("update auth_sessions set revoked_at = $2 where id = $1 and revoked_at is null", [id, now]);
  }

  async revokeAll(now: Date): Promise<void> {
    await revokeAllAuth(this.db, now);
  }

  async listCredentials(): Promise<StoredCredential[]> {
    const { rows } = await this.db.query(
      `select credential_id, public_key, counter, transports, label, created_at
       from auth_credentials where revoked_at is null order by created_at`,
    );
    return rows.map((r: {
      credential_id: string;
      public_key: Buffer;
      counter: string | number;
      transports: string[] | null;
      label: string | null;
      created_at: Date;
    }) => {
      const c: StoredCredential = {
        credentialId: r.credential_id,
        publicKey: new Uint8Array(r.public_key),
        counter: Number(r.counter),
        createdAt: r.created_at,
      };
      if (r.transports) c.transports = r.transports;
      if (r.label !== null) c.label = r.label;
      return c;
    });
  }

  async saveCredential(c: StoredCredential): Promise<void> {
    await this.db.query(
      `insert into auth_credentials (credential_id, public_key, counter, transports, label, created_at)
       values ($1, $2, $3, $4, $5, coalesce($6, now()))`,
      [c.credentialId, Buffer.from(c.publicKey), c.counter, c.transports ?? null, c.label ?? null, c.createdAt ?? null],
    );
  }

  async bumpCounter(credentialId: string, counter: number, now: Date): Promise<void> {
    await this.db.query("update auth_credentials set counter = $2, last_used_at = $3 where credential_id = $1", [
      credentialId,
      counter,
      now,
    ]);
  }

  async putChallenge(kind: "register" | "login", challenge: string, expiresAt: Date): Promise<string> {
    const { rows } = await this.db.query(
      "insert into auth_challenges (kind, challenge, expires_at) values ($1, $2, $3) returning id",
      [kind, challenge, expiresAt],
    );
    return (rows[0] as { id: string }).id;
  }

  async takeChallenge(id: string, kind: "register" | "login", now: Date): Promise<string | null> {
    const { rows } = await this.db.query(
      `update auth_challenges set used_at = $3
       where id = $1 and kind = $2 and used_at is null and expires_at > $3
       returning challenge`,
      [id, kind, now],
    );
    return (rows[0] as { challenge: string } | undefined)?.challenge ?? null;
  }

  async consumeEnrollCode(hash: string, now: Date): Promise<boolean> {
    const { rowCount } = await this.db.query(
      "update auth_enroll_codes set used_at = $2 where code_hash = $1 and used_at is null and expires_at > $2",
      [hash, now],
    );
    return (rowCount ?? 0) > 0;
  }

  async countFailures(since: Date): Promise<number> {
    const { rows } = await this.db.query("select count(*)::int as n from auth_failures where at > $1", [since]);
    return (rows[0] as { n: number } | undefined)?.n ?? 0;
  }

  async recordFailure(kind: string, now: Date): Promise<void> {
    await this.db.query("insert into auth_failures (kind, at) values ($1, $2)", [kind, now]);
  }
}
