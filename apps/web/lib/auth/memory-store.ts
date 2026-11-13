import { randomUUID } from "node:crypto";
import type { AuthStore, Session, StoredCredential } from "./store.js";

interface SessionRec extends Session {
  hash: string;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}
interface CredRec extends StoredCredential {
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}
interface ChallengeRec {
  id: string;
  kind: "register" | "login";
  challenge: string;
  expiresAt: Date;
  usedAt: Date | null;
}
interface CodeRec {
  expiresAt: Date;
  usedAt: Date | null;
}

const copySession = (s: SessionRec): Session => ({
  id: s.id,
  createdAt: new Date(s.createdAt),
  expiresAt: new Date(s.expiresAt),
  hardExpiresAt: new Date(s.hardExpiresAt),
});

/** In-memory AuthStore with the same semantics as PgAuthStore (tests only). */
export class MemoryAuthStore implements AuthStore {
  readonly sessions: SessionRec[] = [];
  readonly credentials: CredRec[] = [];
  readonly challenges: ChallengeRec[] = [];
  readonly enrollCodes = new Map<string, CodeRec>();
  readonly failures: { kind: string; at: Date }[] = [];
  /** Number of touchSession calls, so tests can assert cheap reads. */
  touches = 0;

  /** Test helper: what createEnrollCode would insert. */
  addEnrollCode(hash: string, expiresAt: Date): void {
    this.enrollCodes.set(hash, { expiresAt, usedAt: null });
  }

  async insertSession(hash: string, expiresAt: Date, hardExpiresAt: Date, now: Date): Promise<Session> {
    if (this.sessions.some((s) => s.hash === hash)) throw new Error("duplicate token_hash");
    const rec: SessionRec = {
      id: randomUUID(),
      hash,
      createdAt: new Date(now),
      expiresAt: new Date(expiresAt),
      hardExpiresAt: new Date(hardExpiresAt),
      lastSeenAt: new Date(now),
      revokedAt: null,
    };
    this.sessions.push(rec);
    return copySession(rec);
  }

  async findSession(hash: string, now: Date): Promise<Session | null> {
    const t = now.getTime();
    const s = this.sessions.find(
      (r) => r.hash === hash && !r.revokedAt && r.expiresAt.getTime() > t && r.hardExpiresAt.getTime() > t,
    );
    return s ? copySession(s) : null;
  }

  async touchSession(id: string, expiresAt: Date, now: Date): Promise<void> {
    this.touches++;
    const s = this.sessions.find((r) => r.id === id);
    if (s) {
      s.expiresAt = new Date(expiresAt);
      s.lastSeenAt = new Date(now);
    }
  }

  async revokeSession(id: string, now: Date): Promise<void> {
    const s = this.sessions.find((r) => r.id === id);
    if (s && !s.revokedAt) s.revokedAt = new Date(now);
  }

  async revokeAll(now: Date): Promise<void> {
    for (const s of this.sessions) if (!s.revokedAt) s.revokedAt = new Date(now);
    for (const c of this.credentials) if (!c.revokedAt) c.revokedAt = new Date(now);
    for (const code of this.enrollCodes.values()) if (!code.usedAt) code.usedAt = new Date(now);
    for (const ch of this.challenges) if (!ch.usedAt) ch.usedAt = new Date(now);
  }

  async listCredentials(): Promise<StoredCredential[]> {
    return this.credentials
      .filter((c) => !c.revokedAt)
      .map((c) => {
        const out: StoredCredential = { credentialId: c.credentialId, publicKey: new Uint8Array(c.publicKey), counter: c.counter };
        if (c.transports) out.transports = [...c.transports];
        if (c.label !== undefined) out.label = c.label;
        if (c.createdAt) out.createdAt = new Date(c.createdAt);
        return out;
      });
  }

  async saveCredential(c: StoredCredential): Promise<void> {
    if (this.credentials.some((r) => r.credentialId === c.credentialId)) throw new Error("duplicate credential_id");
    const rec: CredRec = {
      credentialId: c.credentialId,
      publicKey: new Uint8Array(c.publicKey),
      counter: c.counter,
      createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
      lastUsedAt: null,
      revokedAt: null,
    };
    if (c.transports) rec.transports = [...c.transports];
    if (c.label !== undefined) rec.label = c.label;
    this.credentials.push(rec);
  }

  async bumpCounter(credentialId: string, counter: number, now: Date): Promise<void> {
    const c = this.credentials.find((r) => r.credentialId === credentialId);
    if (c) {
      c.counter = counter;
      c.lastUsedAt = new Date(now);
    }
  }

  async putChallenge(kind: "register" | "login", challenge: string, expiresAt: Date): Promise<string> {
    const id = randomUUID();
    this.challenges.push({ id, kind, challenge, expiresAt: new Date(expiresAt), usedAt: null });
    return id;
  }

  async takeChallenge(id: string, kind: "register" | "login", now: Date): Promise<string | null> {
    const ch = this.challenges.find(
      (r) => r.id === id && r.kind === kind && !r.usedAt && r.expiresAt.getTime() > now.getTime(),
    );
    if (!ch) return null;
    ch.usedAt = new Date(now);
    return ch.challenge;
  }

  async consumeEnrollCode(hash: string, now: Date): Promise<boolean> {
    const code = this.enrollCodes.get(hash);
    if (!code || code.usedAt || code.expiresAt.getTime() <= now.getTime()) return false;
    code.usedAt = new Date(now);
    return true;
  }

  async countFailures(since: Date): Promise<number> {
    return this.failures.filter((f) => f.at.getTime() > since.getTime()).length;
  }

  async recordFailure(kind: string, now: Date): Promise<void> {
    this.failures.push({ kind, at: new Date(now) });
  }
}
