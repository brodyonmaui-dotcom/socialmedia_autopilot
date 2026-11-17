// Pure helpers for EnablePush (no React, no DOM globals at import time), so they can be unit-tested.

export const SW_URL = "/app/sw.js";
export const SW_SCOPE = "/app/";

/** A VAPID public key is an uncompressed P-256 point: 65 bytes, 87 base64url chars. */
export function isVapidPublicKey(k: unknown): k is string {
  return typeof k === "string" && /^[A-Za-z0-9_-]{80,100}={0,2}$/.test(k);
}

/** base64url → bytes, for pushManager.subscribe({ applicationServerKey }). */
export function urlBase64ToUint8Array(s: string): Uint8Array<ArrayBuffer> {
  const b64 = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A coarse device label for the subscription list (no model, no version, nothing identifying). */
export function deviceLabel(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  return "Browser";
}

export type PushSupport = "ok" | "no-key" | "not-installed" | "unsupported" | "denied";

/**
 * What the button can do here. On iOS, Web Push exists only in a Home-Screen web app (so a Safari tab
 * reports no PushManager): that case gets the "install first" hint rather than "unsupported".
 */
export function pushSupport(env: { hasKey: boolean; hasServiceWorker: boolean; hasPushManager: boolean; standalone: boolean; ios: boolean; permission: string | null }): PushSupport {
  if (!env.hasKey) return "no-key";
  if (!env.hasServiceWorker || !env.hasPushManager) return env.ios && !env.standalone ? "not-installed" : "unsupported";
  if (env.permission === "denied") return "denied";
  return "ok";
}
