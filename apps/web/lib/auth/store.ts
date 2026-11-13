export interface Session {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  hardExpiresAt: Date;
}

export interface StoredCredential {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
  label?: string;
  createdAt?: Date;
}

/** Persistence for single-user auth. Every method is one atomic statement (no explicit transactions). */
export interface AuthStore {
  insertSession(hash: string, expiresAt: Date, hardExpiresAt: Date, now: Date): Promise<Session>;
  /** null if revoked, expires_at <= now or hard_expires_at <= now. */
  findSession(hash: string, now: Date): Promise<Session | null>;
  /** Sets expires_at and last_seen_at. */
  touchSession(id: string, expiresAt: Date, now: Date): Promise<void>;
  revokeSession(id: string, now: Date): Promise<void>;
  /** Revokes all sessions and credentials. */
  revokeAll(now: Date): Promise<void>;
  /** Non-revoked credentials. */
  listCredentials(): Promise<StoredCredential[]>;
  saveCredential(c: StoredCredential): Promise<void>;
  /** Also sets last_used_at. */
  bumpCounter(credentialId: string, counter: number, now: Date): Promise<void>;
  /** Returns the challenge id. */
  putChallenge(kind: "register" | "login", challenge: string, expiresAt: Date): Promise<string>;
  /** Single use: returns the challenge once, then null. Expired → null. */
  takeChallenge(id: string, kind: "register" | "login", now: Date): Promise<string | null>;
  /** Single use: true once for an unexpired, unused code hash. */
  consumeEnrollCode(hash: string, now: Date): Promise<boolean>;
  countFailures(since: Date): Promise<number>;
  recordFailure(kind: string, now: Date): Promise<void>;
}
