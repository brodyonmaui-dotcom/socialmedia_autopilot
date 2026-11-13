import { describe, expect, it } from "vitest";
import { REDACTED, sanitizeError, sanitizeForLog } from "../sanitize.js";

// Synthetic token shapes (not real credentials). Built by concatenation so no full token literal sits in the repo.
const META = "EAAB" + "x7Yq2Lm9Pz3Kd8Rw4Tn6Vb1Hc5Jf0Gs";
const GOOGLE_ACCESS = "ya29." + "a0AfB_byC7dEfGh1JkLmN2oPqRsT3uVwXyZ";
const GOOGLE_REFRESH = "1//" + "0gAbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const ANTHROPIC = "sk-ant-" + "api03-AbCdEf1234567890GhIjKl";
const ZERNIO = "sk_" + "live_9fA3kLm2Qx7Rt8Vw1Yz4Bc6De0Gh";
const HEX = "a3f9".repeat(12);
const B64 = "Zm9vYmFyQmF6" + "Q3V4MTIzNDU2Nzg5MEFiQ2RlRmdoSWprTG1ub1A=";
const OPAQUE = "q8Lr2Ns5Tv9Xw";

const TOKEN_FIXTURES = [
  `Authorization: Bearer ${ZERNIO}`,
  `https://graph.facebook.com/v25.0/debug_token?input_token=${META}&access_token=1234567890123|${OPAQUE}${OPAQUE}`,
  `refresh_token=${GOOGLE_REFRESH}&client_id=c&client_secret=${OPAQUE}${OPAQUE}`,
  `{"access_token":"${GOOGLE_ACCESS}","api_key": "${OPAQUE}${OPAQUE}"}`,
  `?key=${OPAQUE}${OPAQUE}&part=snippet`,
  `token: ${OPAQUE}${OPAQUE} secret='${OPAQUE}${OPAQUE}'`,
  `anthropic said no for ${ANTHROPIC}`,
  `meta token ${META} leaked`,
  `google ${GOOGLE_ACCESS} and ${GOOGLE_REFRESH}`,
  `sha ${HEX} blob ${B64}`,
];
/** The secret parts of the fixtures: none may survive sanitising. */
const SECRET_PARTS = [META.slice(4), GOOGLE_ACCESS.slice(4), GOOGLE_REFRESH.slice(4), ANTHROPIC.slice(4), ZERNIO.slice(4), HEX.slice(4), B64.slice(4), OPAQUE + OPAQUE, OPAQUE];

describe("sanitizeForLog", () => {
  it("no token shape survives", () => {
    for (const f of TOKEN_FIXTURES) {
      const out = sanitizeForLog(f);
      for (const s of SECRET_PARTS) expect(out, `${f} -> ${out}`).not.toContain(s);
      expect(out).toContain(REDACTED);
    }
  });

  it("keeps the first 4 chars of a long token so you can tell which credential it was", () => {
    expect(sanitizeForLog(`meta ${META}`)).toBe(`meta EAAB${REDACTED}`);
    expect(sanitizeForLog(`Bearer ${ZERNIO}`)).toBe(`Bearer sk_l${REDACTED}`);
    expect(sanitizeForLog("access_token=abc123&f=1")).toBe(`access_token=${REDACTED}&f=1`); // short: nothing kept
  });

  it("is idempotent", () => {
    for (const f of TOKEN_FIXTURES) {
      const once = sanitizeForLog(f);
      expect(sanitizeForLog(once)).toBe(once);
    }
    expect(sanitizeForLog("Bearer [REDACTED]")).toBe("Bearer [REDACTED]");
    expect(sanitizeForLog("access_token=[REDACTED]&x")).toBe("access_token=[REDACTED]&x");
  });

  it("leaves ordinary text, ids, URLs and file paths alone", () => {
    const plain = [
      "[outbox] published instagram post-1 -> https://instagram.com/p/C0abc123",
      "fake instagram: rejected (HTTP 400)",
      "at runOutboxTick (/opt/autopilot/packages/core/src/outbox/engine.ts:201:30)",
      "publish exceeded 300000 ms — outcome unknown",
      "Invalid OAuth access token.",
    ];
    for (const p of plain) expect(sanitizeForLog(p)).toBe(p);
  });
});

describe("sanitizeError", () => {
  it("message + PlatformRequestError-like body, truncated to 300 chars, all sanitised", () => {
    const err = Object.assign(new Error("instagram: HTTP 400"), { status: 400, body: { error: { message: `bad param access_token=${META}`, pad: "x".repeat(500) } } });
    const out = sanitizeError(err);
    expect(out.startsWith("instagram: HTTP 400 · body: ")).toBe(true);
    expect(out).not.toContain(META.slice(4));
    expect(out.length).toBeLessThan(400);
  });
  it("handles strings and non-errors", () => {
    expect(sanitizeError(`boom Bearer ${ZERNIO}`)).toBe(`boom Bearer sk_l${REDACTED}`);
    expect(sanitizeError({ code: "ECONNRESET" })).toContain("ECONNRESET");
    expect(sanitizeError(undefined)).toBe("undefined");
  });
});
