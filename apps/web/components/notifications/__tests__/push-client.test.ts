import { describe, expect, it } from "vitest";
import { deviceLabel, isVapidPublicKey, pushSupport, urlBase64ToUint8Array } from "../push-client.js";

const base = { hasKey: true, hasServiceWorker: true, hasPushManager: true, standalone: true, ios: true, permission: "default" };

describe("push-client", () => {
  it("decodes base64url (VAPID keys are unpadded base64url)", () => {
    expect([...urlBase64ToUint8Array("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
    expect(urlBase64ToUint8Array("B" + "A".repeat(86)).length).toBe(65);
  });

  it("accepts only VAPID-shaped public keys", () => {
    expect(isVapidPublicKey("B" + "A".repeat(86))).toBe(true);
    for (const bad of ["", "short", "B".repeat(87) + "!", undefined, null, 5]) expect(isVapidPublicKey(bad)).toBe(false);
  });

  it("device labels are coarse", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 15)")).toBe("Android");
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Browser");
  });

  it("support states: install hint on an iOS Safari tab, denied, no key", () => {
    expect(pushSupport(base)).toBe("ok");
    expect(pushSupport({ ...base, hasPushManager: false, standalone: false })).toBe("not-installed");
    expect(pushSupport({ ...base, hasPushManager: false, ios: false, standalone: false })).toBe("unsupported");
    expect(pushSupport({ ...base, permission: "denied" })).toBe("denied");
    expect(pushSupport({ ...base, hasKey: false })).toBe("no-key");
  });
});
