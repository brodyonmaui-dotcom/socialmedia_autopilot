import { createHash, randomInt } from "node:crypto";

/** Minimal query surface shared by pg Pool, pg Client and test fakes. */
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export const ENROLL_CODE_TTL_MS = 15 * 60_000;

// No 0/O/1/I so a code read off a terminal can be typed on a phone without guessing.
const ENROLL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** 8 chars, formatted "XXXX-XXXX". */
export function newEnrollCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ENROLL_ALPHABET[randomInt(ENROLL_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normalizeEnrollCode(s: string): string {
  return s.toUpperCase().replace(/[\s-]+/g, "");
}

/** Stores only the hash; the plain code is returned once and never persisted. */
export async function createEnrollCode(db: Queryable, now = new Date()): Promise<{ code: string; expiresAt: Date }> {
  const code = newEnrollCode();
  const expiresAt = new Date(now.getTime() + ENROLL_CODE_TTL_MS);
  await db.query("insert into auth_enroll_codes (code_hash, expires_at) values ($1, $2)", [
    sha256Hex(normalizeEnrollCode(code)),
    expiresAt,
  ]);
  return { code, expiresAt };
}

/**
 * Revokes every session and passkey, burns unused enrol codes and challenges, and (lost phone) revokes
 * every Web Push subscription so a lost device stops getting alert notifications. Never deletes rows.
 * The push step runs last and tolerates a DB without migration 0008 (the auth part must always work).
 */
export async function revokeAllAuth(db: Queryable, now = new Date()): Promise<{ sessions: number; credentials: number; pushSubscriptions: number }> {
  const s = await db.query("update auth_sessions set revoked_at = $1 where revoked_at is null", [now]);
  const c = await db.query("update auth_credentials set revoked_at = $1 where revoked_at is null", [now]);
  await db.query("update auth_enroll_codes set used_at = $1 where used_at is null", [now]);
  await db.query("update auth_challenges set used_at = $1 where used_at is null", [now]);
  let pushSubscriptions = 0;
  try {
    const p = await db.query("update push_subscriptions set revoked_at = $1 where revoked_at is null", [now]);
    pushSubscriptions = p.rowCount ?? 0;
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") throw err; // undefined_table: 0008 not applied yet
  }
  return { sessions: s.rowCount ?? 0, credentials: c.rowCount ?? 0, pushSubscriptions };
}
