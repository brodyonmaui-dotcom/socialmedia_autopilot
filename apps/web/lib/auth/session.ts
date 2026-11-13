import { randomBytes } from "node:crypto";
import { sha256Hex } from "@autopilot/db";
import type { AuthStore, Session } from "./store.js";

export const SESSION_COOKIE = "ap_session";
export const SLIDING_MS = 30 * 86_400_000;
export const HARD_CAP_MS = 90 * 86_400_000;
/** Only write the sliding expiry back when it moves by more than this (keeps reads cheap). */
const TOUCH_THRESHOLD_MS = 3_600_000;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes as base64url (43 chars). Only the hash is ever stored. */
export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

/** Shape check only (no DB): usable from middleware. */
export function isWellFormedToken(t: string | undefined): t is string {
  return typeof t === "string" && TOKEN_RE.test(t);
}

export async function createSession(store: AuthStore, now = new Date()): Promise<{ token: string; session: Session }> {
  const { token, hash } = newSessionToken();
  const hardExpiresAt = new Date(now.getTime() + HARD_CAP_MS);
  const expiresAt = new Date(Math.min(now.getTime() + SLIDING_MS, hardExpiresAt.getTime()));
  const session = await store.insertSession(hash, expiresAt, hardExpiresAt, now);
  return { token, session };
}

export async function validateSession(
  store: AuthStore,
  token: string | undefined,
  now = new Date(),
): Promise<Session | null> {
  if (!isWellFormedToken(token)) return null;
  const session = await store.findSession(hashToken(token), now);
  if (!session) return null;
  const slid = Math.min(now.getTime() + SLIDING_MS, session.hardExpiresAt.getTime());
  if (slid - session.expiresAt.getTime() > TOUCH_THRESHOLD_MS) {
    const expiresAt = new Date(slid);
    await store.touchSession(session.id, expiresAt, now);
    return { ...session, expiresAt };
  }
  return session;
}

export async function revokeSession(store: AuthStore, id: string, now = new Date()): Promise<void> {
  await store.revokeSession(id, now);
}

export function sessionCookieOptions(secure: boolean): {
  name: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "strict";
  path: "/app";
  maxAge: number;
} {
  return { name: SESSION_COOKIE, httpOnly: true, secure, sameSite: "strict", path: "/app", maxAge: HARD_CAP_MS / 1000 };
}
