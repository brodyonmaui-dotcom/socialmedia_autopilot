import { describe, expect, it, vi } from "vitest";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { ENROLL_CODE_TTL_MS, normalizeEnrollCode, sha256Hex } from "@autopilot/db";
import type { AuthConfig } from "../config.js";
import { MemoryAuthStore } from "../memory-store.js";
import { MAX_FAILURES, RateLimitedError } from "../rate-limit.js";
import { validateSession } from "../session.js";
import {
  AuthError,
  beginLogin,
  beginRegistration,
  CHALLENGE_TTL_MS,
  finishLogin,
  finishRegistration,
  MAX_CREDENTIALS,
  type WebAuthnDeps,
} from "../webauthn.js";

const cfg: AuthConfig = { rpID: "rp.test", origin: "https://rp.test", rpName: "runmysocials", secureCookie: true };
const T0 = new Date("2026-01-01T00:00:00Z");
const MIN = 60_000;

function stubLib() {
  let n = 0;
  return {
    generateRegistrationOptions: vi.fn(async (o: { rpID: string }) => ({ challenge: `reg-${++n}`, rp: { id: o.rpID } }) as never),
    generateAuthenticationOptions: vi.fn(async (o: { rpID: string }) => ({ challenge: `login-${++n}`, rpId: o.rpID }) as never),
    verifyRegistrationResponse: vi.fn(async (o: { response: { id: string } }) => ({
      verified: true as const,
      registrationInfo: { credential: { id: o.response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] } },
    }) as never),
    verifyAuthenticationResponse: vi.fn(async () => ({ verified: true, authenticationInfo: { newCounter: 5 } }) as never),
  };
}

function setup() {
  const store = new MemoryAuthStore();
  let now = T0;
  const lib = stubLib();
  const alerts: string[] = [];
  const d: WebAuthnDeps = { store, cfg, lib, now: () => now, onAlert: async (m) => void alerts.push(m) };
  const code = (plain: string) => store.addEnrollCode(sha256Hex(normalizeEnrollCode(plain)), new Date(now.getTime() + ENROLL_CODE_TTL_MS));
  return { store, lib, d, alerts, code, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

const regResponse = (id: string) => ({ id, rawId: id, type: "public-key", response: {} }) as unknown as RegistrationResponseJSON;
const authResponse = (id: string) => ({ id, rawId: id, type: "public-key", response: {} }) as unknown as AuthenticationResponseJSON;

async function enrol(s: ReturnType<typeof setup>, id: string, plain = `CODE-${id}`.slice(0, 9)) {
  s.code(plain);
  const { challengeId } = await beginRegistration(s.d, plain);
  await finishRegistration(s.d, challengeId, regResponse(id), "iPhone");
}

describe("registration", () => {
  it("needs a valid enrol code; a bad one is an AuthError and a recorded failure", async () => {
    const s = setup();
    await expect(beginRegistration(s.d, "WRNG-CODE")).rejects.toBeInstanceOf(AuthError);
    expect(s.store.failures.map((f) => f.kind)).toEqual(["enroll-code"]);
    s.code("ABCD-EFGH");
    const { challengeId, options } = await beginRegistration(s.d, "abcd efgh");
    expect(options.challenge).toBe("reg-1");
    await finishRegistration(s.d, challengeId, regResponse("cred-1"), "iPhone");
    const creds = await s.store.listCredentials();
    expect(creds).toHaveLength(1);
    expect(creds[0]).toMatchObject({ credentialId: "cred-1", counter: 0, transports: ["internal"], label: "iPhone" });
    // code is single use
    await expect(beginRegistration(s.d, "ABCD-EFGH")).rejects.toThrow("code invalid or expired");
  });

  it("an expired code is refused", async () => {
    const s = setup();
    s.code("ABCD-EFGH");
    s.advance(ENROLL_CODE_TTL_MS + 1);
    await expect(beginRegistration(s.d, "ABCD-EFGH")).rejects.toBeInstanceOf(AuthError);
  });

  it("passes rpID/origin/challenge from cfg and the stored challenge to the lib", async () => {
    const s = setup();
    await enrol(s, "c1");
    expect(s.lib.generateRegistrationOptions.mock.calls[0]![0]).toMatchObject({
      rpID: "rp.test",
      rpName: "runmysocials",
      userName: "creator",
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      excludeCredentials: [],
    });
    expect(s.lib.verifyRegistrationResponse.mock.calls[0]![0]).toMatchObject({
      expectedChallenge: "reg-1",
      expectedOrigin: "https://rp.test",
      expectedRPID: "rp.test",
    });
    s.code("WXYZ-2345");
    await beginRegistration(s.d, "WXYZ-2345");
    expect(s.lib.generateRegistrationOptions.mock.calls[1]![0]).toMatchObject({ excludeCredentials: [{ id: "c1", transports: ["internal"] }] });
  });

  it("challenge is single use and expires", async () => {
    const s = setup();
    s.code("ABCD-EFGH");
    const { challengeId } = await beginRegistration(s.d, "ABCD-EFGH");
    await finishRegistration(s.d, challengeId, regResponse("c1"));
    await expect(finishRegistration(s.d, challengeId, regResponse("c2"))).rejects.toBeInstanceOf(AuthError);
    s.code("WXYZ-2345");
    const second = await beginRegistration(s.d, "WXYZ-2345");
    s.advance(CHALLENGE_TTL_MS + 1);
    await expect(finishRegistration(s.d, second.challengeId, regResponse("c3"))).rejects.toBeInstanceOf(AuthError);
    expect((await s.store.listCredentials()).map((c) => c.credentialId)).toEqual(["c1"]);
    expect(s.store.failures.filter((f) => f.kind === "register")).toHaveLength(2);
  });

  it("verified:false is a failure and saves nothing", async () => {
    const s = setup();
    s.lib.verifyRegistrationResponse.mockResolvedValueOnce({ verified: false } as never);
    s.code("ABCD-EFGH");
    const { challengeId } = await beginRegistration(s.d, "ABCD-EFGH");
    await expect(finishRegistration(s.d, challengeId, regResponse("c1"))).rejects.toBeInstanceOf(AuthError);
    expect(await s.store.listCredentials()).toEqual([]);
    expect(s.store.failures).toHaveLength(1);
  });

  it(`refuses a ${MAX_CREDENTIALS + 1}th credential`, async () => {
    const s = setup();
    for (let i = 0; i < MAX_CREDENTIALS; i++) await enrol(s, `c${i}`, `AAAA-AAA${"23456789"[i]}`);
    s.code("BBBB-BBBB");
    await expect(beginRegistration(s.d, "BBBB-BBBB")).rejects.toThrow(/already 5 passkeys/);
    expect(await s.store.listCredentials()).toHaveLength(MAX_CREDENTIALS);
  });
});

describe("login", () => {
  it("is refused when no passkey is enrolled", async () => {
    const s = setup();
    await expect(beginLogin(s.d)).rejects.toThrow("no passkey enrolled yet");
  });

  it("success creates a session and bumps the counter", async () => {
    const s = setup();
    await enrol(s, "c1");
    const { challengeId, options } = await beginLogin(s.d);
    expect(s.lib.generateAuthenticationOptions.mock.calls[0]![0]).toMatchObject({
      rpID: "rp.test",
      allowCredentials: [{ id: "c1", transports: ["internal"] }],
    });
    const { token, session } = await finishLogin(s.d, challengeId, authResponse("c1"));
    const call = s.lib.verifyAuthenticationResponse.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(call[0]).toMatchObject({
      expectedChallenge: options.challenge,
      expectedOrigin: "https://rp.test",
      expectedRPID: "rp.test",
      credential: { id: "c1", counter: 0 },
    });
    expect((await s.store.listCredentials())[0]!.counter).toBe(5);
    expect(s.store.credentials[0]!.lastUsedAt).not.toBeNull();
    expect((await validateSession(s.store, token, s.d.now!()))?.id).toBe(session.id);
    // challenge is single use
    await expect(finishLogin(s.d, challengeId, authResponse("c1"))).rejects.toBeInstanceOf(AuthError);
  });

  it("verified:false (e.g. counter regression) records a failure and creates no session", async () => {
    const s = setup();
    await enrol(s, "c1");
    s.lib.verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false, authenticationInfo: { newCounter: 0 } } as never);
    const { challengeId } = await beginLogin(s.d);
    await expect(finishLogin(s.d, challengeId, authResponse("c1"))).rejects.toBeInstanceOf(AuthError);
    expect(s.store.sessions).toHaveLength(0);
    expect(s.store.failures.map((f) => f.kind)).toEqual(["login"]);
  });

  it("a lib error (thrown) is a failure too", async () => {
    const s = setup();
    await enrol(s, "c1");
    s.lib.verifyAuthenticationResponse.mockRejectedValueOnce(new Error("counter lower than expected"));
    const { challengeId } = await beginLogin(s.d);
    await expect(finishLogin(s.d, challengeId, authResponse("c1"))).rejects.toThrow("passkey could not be verified");
    expect(s.store.sessions).toHaveLength(0);
  });

  it("an unknown credential id is a failure", async () => {
    const s = setup();
    await enrol(s, "c1");
    const { challengeId } = await beginLogin(s.d);
    await expect(finishLogin(s.d, challengeId, authResponse("nope"))).rejects.toBeInstanceOf(AuthError);
    expect(s.lib.verifyAuthenticationResponse).not.toHaveBeenCalled();
    expect(s.store.failures).toHaveLength(1);
  });

  it("an expired login challenge fails", async () => {
    const s = setup();
    await enrol(s, "c1");
    const { challengeId } = await beginLogin(s.d);
    s.advance(CHALLENGE_TTL_MS + 1);
    await expect(finishLogin(s.d, challengeId, authResponse("c1"))).rejects.toBeInstanceOf(AuthError);
  });

  it("after 10 failures beginLogin throws RateLimitedError and one alert fired", async () => {
    const s = setup();
    await enrol(s, "c1");
    for (let i = 0; i < MAX_FAILURES; i++) {
      await expect(beginRegistration(s.d, "BAD0-CODE")).rejects.toBeInstanceOf(AuthError);
    }
    await expect(beginLogin(s.d)).rejects.toBeInstanceOf(RateLimitedError);
    expect(s.alerts).toHaveLength(1);
    s.advance(15 * MIN + 1);
    await expect(beginLogin(s.d)).resolves.toMatchObject({ options: { challenge: expect.any(String) } });
  });
});
