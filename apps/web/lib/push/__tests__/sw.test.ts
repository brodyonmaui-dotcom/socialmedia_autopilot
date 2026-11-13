import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALERT_KINDS } from "@autopilot/core";
import { kindLabel } from "../../alerts/queries.js";

const publicDir = fileURLToPath(new URL("../../../public/", import.meta.url));
const swSrc = readFileSync(`${publicDir}sw.js`, "utf8");

type Listener = (e: unknown) => void;

/** Loads public/sw.js against a fake ServiceWorkerGlobalScope. */
function loadSw() {
  const listeners: Record<string, Listener> = {};
  const shown: Array<{ title: string; opts: { body: string; data: { url: string } } }> = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (t: string, fn: Listener) => (listeners[t] = fn),
    skipWaiting: () => {},
    registration: { showNotification: async (title: string, opts: never) => void shown.push({ title, opts }) },
    clients: { claim: async () => {}, matchAll: async () => [] as unknown[], openWindow: async (u: string) => void opened.push(u) },
  };
  new Function("self", swSrc)(self);
  const fire = async (type: string, event: Record<string, unknown>) => {
    let p: Promise<unknown> = Promise.resolve();
    listeners[type]!({ ...event, waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
  };
  const push = (data: unknown) => fire("push", { data: { json: () => (typeof data === "string" ? JSON.parse(data) : data) } });
  return { listeners, shown, opened, fire, push, self };
}

describe("public/sw.js", () => {
  it("push → 'N new alerts' with a body of kind names only", async () => {
    const sw = loadSw();
    await sw.push({ count: 3, kinds: ["final-failure", "auth"], sources: ["instagram", "web"], url: "/app/alerts" });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]!.title).toBe("3 new alerts");
    expect(sw.shown[0]!.opts.body).toBe("Failed · Login");
    expect(sw.shown[0]!.opts.data.url).toBe("/app/alerts");
  });

  it("one alert, a test payload, unknown kinds and a broken payload", async () => {
    const sw = loadSw();
    await sw.push({ count: 1, kinds: ["engagement-kill"] });
    await sw.push({ count: 0, kinds: [], sources: [], url: "/app/alerts", test: true });
    await sw.push({ count: 2, kinds: ["<b>evil</b>", "auth"] });
    await sw.fire("push", { data: { json: () => JSON.parse("{not json") } });
    expect(sw.shown.map((s) => s.title)).toEqual(["1 new alert", "Test notification", "2 new alerts", "1 new alert"]);
    expect(sw.shown[2]!.opts.body).toBe("Login");
    expect(sw.shown.map((s) => s.opts.body).join()).not.toContain("evil");
  });

  it("a click always opens /app/alerts, whatever the payload url says", async () => {
    const sw = loadSw();
    let closed = false;
    await sw.fire("notificationclick", { notification: { close: () => (closed = true), data: { url: "https://evil.example.com" } } });
    expect(closed).toBe(true);
    expect(sw.opened).toEqual(["/app/alerts"]);
  });

  it("focuses an open app window instead of opening a new one", async () => {
    const sw = loadSw();
    const nav: string[] = [];
    let focused = false;
    sw.self.clients.matchAll = async () => [{ navigate: async (u: string) => void nav.push(u), focus: async () => void (focused = true) }];
    await sw.fire("notificationclick", { notification: { close: () => {} } });
    expect(nav).toEqual(["/app/alerts"]);
    expect(focused).toBe(true);
    expect(sw.opened).toEqual([]);
  });

  it("has no fetch handler (no caching of private pages)", () => {
    expect(Object.keys(loadSw().listeners).sort()).toEqual(["activate", "install", "notificationclick", "push"]);
  });

  it("kind labels match the /alerts page for every kind", async () => {
    for (const k of ALERT_KINDS) {
      const sw = loadSw();
      await sw.push({ count: 1, kinds: [k] });
      expect(sw.shown[0]!.opts.body, k).toBe(kindLabel(k));
    }
  });
});

describe("manifest + icons", () => {
  const manifest = JSON.parse(readFileSync(`${publicDir}manifest.json`, "utf8")) as { icons: Array<{ src: string; sizes: string; purpose?: string }> };

  it("lists 192 + 512 + a maskable icon whose files exist and are PNGs of that size", () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const i of manifest.icons) {
      const file = `${publicDir}${i.src.replace(/^\/app\//, "")}`;
      expect(existsSync(file), i.src).toBe(true);
      const buf = readFileSync(file);
      expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
      const [w, h] = i.sizes.split("x").map(Number);
      expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([w, h]);
    }
  });

  it("the apple-touch-icon in layout exists", () => {
    const layout = readFileSync(fileURLToPath(new URL("../../../app/layout.tsx", import.meta.url)), "utf8");
    const m = /apple: "\/app\/(icons\/[\w.-]+\.png)"/.exec(layout);
    expect(m).not.toBeNull();
    expect(existsSync(`${publicDir}${m![1]}`)).toBe(true);
  });
});

describe("VAPID public key", () => {
  it("comes from runtime env in the server page, never NEXT_PUBLIC_*", () => {
    const page = readFileSync(fileURLToPath(new URL("../../../app/alerts/page.tsx", import.meta.url)), "utf8");
    expect(page).toMatch(/process\.env\.VAPID_PUBLIC_KEY/);
    const web = ["../../../app/alerts/ui/EnablePush.tsx", "../../../app/alerts/ui/push-client.ts", "../../../app/alerts/page.tsx"].map((r) =>
      readFileSync(fileURLToPath(new URL(r, import.meta.url)), "utf8"),
    );
    for (const src of web) {
      expect(src).not.toMatch(/NEXT_PUBLIC_VAPID/);
      expect(src).not.toMatch(/VAPID_PRIVATE_KEY/);
    }
  });
});
