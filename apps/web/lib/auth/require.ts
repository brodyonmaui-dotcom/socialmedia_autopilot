// Server only (next/headers): import from server components and server actions, never from client code.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../db.js";
import { authConfigFromEnv } from "./config.js";
import { PgAuthStore } from "./pg-store.js";
import { SESSION_COOKIE, sessionCookieOptions, validateSession } from "./session.js";
import type { Session } from "./store.js";

export function getAuthStore(): PgAuthStore {
  return new PgAuthStore(getPool());
}

/** The current session, or null. Never redirects. */
export async function getOptionalSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return validateSession(getAuthStore(), token);
}

/** First statement of every DB-touching page and server action. Redirects to /login (basePath added by Next). */
export async function requireSession(): Promise<Session> {
  const session = await getOptionalSession();
  if (!session) redirect("/login");
  return session;
}

export async function setSessionCookie(token: string): Promise<void> {
  const { name, ...opts } = sessionCookieOptions(authConfigFromEnv().secureCookie);
  (await cookies()).set(name, token, opts);
}

export async function clearSessionCookie(): Promise<void> {
  const { name, ...opts } = sessionCookieOptions(authConfigFromEnv().secureCookie);
  (await cookies()).set(name, "", { ...opts, maxAge: 0 });
}
