"use server";

// The ONLY server actions reachable without a session (they ARE the login). Each returns a
// plain result with a generic, safe message; stacks and DB errors never reach the browser.
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { redirect } from "next/navigation";
import { getPool } from "../../lib/db.js";
import { writeAuthAlert } from "../../lib/auth/alerts.js";
import { authConfigFromEnv } from "../../lib/auth/config.js";
import { RateLimitedError } from "../../lib/auth/rate-limit.js";
import { clearSessionCookie, getAuthStore, getOptionalSession, requireSession, setSessionCookie } from "../../lib/auth/require.js";
import { AuthError, beginLogin, beginRegistration, finishLogin, finishRegistration, type WebAuthnDeps } from "../../lib/auth/webauthn.js";

type Fail = { ok: false; error: string };

function deps(): WebAuthnDeps {
  return { store: getAuthStore(), cfg: authConfigFromEnv(), onAlert: (m) => writeAuthAlert(getPool(), m) };
}

function failure(err: unknown): Fail {
  if (err instanceof AuthError || err instanceof RateLimitedError) return { ok: false, error: err.message };
  return { ok: false, error: "something went wrong, try again" };
}

export async function beginRegistrationAction(
  code: string,
): Promise<{ ok: true; challengeId: string; options: PublicKeyCredentialCreationOptionsJSON } | Fail> {
  try {
    if (typeof code !== "string" || code.length > 32) return { ok: false, error: "code invalid or expired" };
    return { ok: true, ...(await beginRegistration(deps(), code)) };
  } catch (err) {
    return failure(err);
  }
}

export async function finishRegistrationAction(
  challengeId: string,
  response: RegistrationResponseJSON,
  label?: string,
): Promise<{ ok: true } | Fail> {
  try {
    await finishRegistration(deps(), String(challengeId), response, typeof label === "string" ? label : undefined);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function beginLoginAction(): Promise<
  { ok: true; challengeId: string; options: PublicKeyCredentialRequestOptionsJSON } | Fail
> {
  try {
    return { ok: true, ...(await beginLogin(deps())) };
  } catch (err) {
    return failure(err);
  }
}

export async function finishLoginAction(challengeId: string, response: AuthenticationResponseJSON): Promise<{ ok: true } | Fail> {
  try {
    const { token } = await finishLogin(deps(), String(challengeId), response);
    await setSessionCookie(token);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** Signs out this device. */
export async function logoutAction(): Promise<void> {
  const session = await getOptionalSession();
  if (session) await getAuthStore().revokeSession(session.id, new Date());
  await clearSessionCookie();
  redirect("/login");
}

/** Signs out every device and revokes every passkey; re-enrol with `pnpm auth:enroll` on the server. */
export async function logoutEverywhereAction(): Promise<void> {
  await requireSession();
  await getAuthStore().revokeAll(new Date());
  await clearSessionCookie();
  redirect("/login");
}
