import * as simplewebauthn from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { normalizeEnrollCode, sha256Hex } from "@autopilot/db";
import type { AuthConfig } from "./config.js";
import { assertNotRateLimited, recordAuthFailure } from "./rate-limit.js";
import { createSession } from "./session.js";
import type { AuthStore, Session } from "./store.js";

export const MAX_CREDENTIALS = 5;
export const CHALLENGE_TTL_MS = 5 * 60_000;

type Lib = Pick<
  typeof simplewebauthn,
  "generateRegistrationOptions" | "verifyRegistrationResponse" | "generateAuthenticationOptions" | "verifyAuthenticationResponse"
>;

export interface WebAuthnDeps {
  store: AuthStore;
  cfg: AuthConfig;
  now?: () => Date;
  lib?: Lib;
  /** Called once when the failure rate limit trips (the app writes an alerts row). */
  onAlert?: (message: string) => Promise<void>;
}

/** Message is safe to show on the login page. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

// One fixed user: this is a single-creator tool, not a SaaS.
const USER_NAME = "creator";
const USER_ID = new TextEncoder().encode("creator");

const nowOf = (d: WebAuthnDeps) => (d.now ? d.now() : new Date());
const libOf = (d: WebAuthnDeps): Lib => d.lib ?? simplewebauthn;

async function fail(d: WebAuthnDeps, kind: "login" | "register" | "enroll-code", now: Date, message: string): Promise<never> {
  await recordAuthFailure(d.store, kind, now, d.onAlert ?? (async () => {}));
  throw new AuthError(message);
}

export async function beginRegistration(
  d: WebAuthnDeps,
  enrollCode: string,
): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const now = nowOf(d);
  await assertNotRateLimited(d.store, now);
  const ok = await d.store.consumeEnrollCode(sha256Hex(normalizeEnrollCode(enrollCode)), now);
  if (!ok) return fail(d, "enroll-code", now, "code invalid or expired");
  const existing = await d.store.listCredentials();
  if (existing.length >= MAX_CREDENTIALS) {
    throw new AuthError(`already ${MAX_CREDENTIALS} passkeys: revoke all (auth:revoke-all) to start over`);
  }
  const options = await libOf(d).generateRegistrationOptions({
    rpName: d.cfg.rpName,
    rpID: d.cfg.rpID,
    userName: USER_NAME,
    userID: USER_ID,
    userDisplayName: USER_NAME,
    attestationType: "none",
    excludeCredentials: existing.map((c) => (c.transports ? { id: c.credentialId, transports: c.transports } : { id: c.credentialId })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  const challengeId = await d.store.putChallenge("register", options.challenge, new Date(now.getTime() + CHALLENGE_TTL_MS));
  return { challengeId, options };
}

export async function finishRegistration(
  d: WebAuthnDeps,
  challengeId: string,
  response: RegistrationResponseJSON,
  label?: string,
): Promise<void> {
  const now = nowOf(d);
  await assertNotRateLimited(d.store, now);
  const challenge = await d.store.takeChallenge(challengeId, "register", now);
  if (!challenge) return fail(d, "register", now, "this attempt expired, start again");
  let result: Awaited<ReturnType<Lib["verifyRegistrationResponse"]>>;
  try {
    result = await libOf(d).verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: d.cfg.origin,
      expectedRPID: d.cfg.rpID,
      requireUserVerification: false,
    });
  } catch {
    return fail(d, "register", now, "passkey could not be verified");
  }
  if (!result.verified) return fail(d, "register", now, "passkey could not be verified");
  if ((await d.store.listCredentials()).length >= MAX_CREDENTIALS) {
    throw new AuthError(`already ${MAX_CREDENTIALS} passkeys`);
  }
  const { credential } = result.registrationInfo;
  const cleanLabel = label?.replace(/[^\w .,()-]/g, "").trim().slice(0, 40);
  await d.store.saveCredential({
    credentialId: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    ...(credential.transports ? { transports: credential.transports } : {}),
    ...(cleanLabel ? { label: cleanLabel } : {}),
  });
}

export async function beginLogin(d: WebAuthnDeps): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const now = nowOf(d);
  await assertNotRateLimited(d.store, now);
  const creds = await d.store.listCredentials();
  if (creds.length === 0) throw new AuthError("no passkey enrolled yet");
  const options = await libOf(d).generateAuthenticationOptions({
    rpID: d.cfg.rpID,
    allowCredentials: creds.map((c) => (c.transports ? { id: c.credentialId, transports: c.transports } : { id: c.credentialId })),
    userVerification: "preferred",
  });
  const challengeId = await d.store.putChallenge("login", options.challenge, new Date(now.getTime() + CHALLENGE_TTL_MS));
  return { challengeId, options };
}

export async function finishLogin(
  d: WebAuthnDeps,
  challengeId: string,
  response: AuthenticationResponseJSON,
): Promise<{ token: string; session: Session }> {
  const now = nowOf(d);
  await assertNotRateLimited(d.store, now);
  const challenge = await d.store.takeChallenge(challengeId, "login", now);
  if (!challenge) return fail(d, "login", now, "this attempt expired, start again");
  const cred = (await d.store.listCredentials()).find((c) => c.credentialId === response.id);
  if (!cred) return fail(d, "login", now, "passkey not recognised");
  let verified = false;
  let newCounter = cred.counter;
  try {
    const result = await libOf(d).verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: d.cfg.origin,
      expectedRPID: d.cfg.rpID,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(cred.publicKey),
        counter: cred.counter,
        ...(cred.transports ? { transports: cred.transports } : {}),
      },
      requireUserVerification: false,
    });
    verified = result.verified;
    newCounter = result.authenticationInfo.newCounter;
  } catch {
    verified = false; // includes the lib's counter-regression refusal
  }
  if (!verified) return fail(d, "login", now, "passkey could not be verified");
  await d.store.bumpCounter(cred.credentialId, newCounter, now);
  return createSession(d.store, now);
}
