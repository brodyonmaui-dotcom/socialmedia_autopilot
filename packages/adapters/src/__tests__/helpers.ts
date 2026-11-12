import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { OutboxPost } from "@autopilot/core";
import type { FetchLike } from "../http.js";

export function fixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8")) as T;
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  json?: any;
  form?: Record<string, string>;
}

export type Route = [match: (url: string, init?: RequestInit) => boolean, respond: (call: RecordedCall) => Response | Promise<Response>];

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** A fetch that routes by URL/method and records every call (bodies parsed as JSON or form). Throws on an unmatched URL. */
export function router(routes: Route[]): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const h = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    h.forEach((v, k) => (headers[k] = v));
    const call: RecordedCall = { url, method: init?.method ?? "GET", headers };
    if (typeof init?.body === "string") {
      call.body = init.body;
      try {
        call.json = JSON.parse(init.body);
      } catch {
        /* not json */
      }
    } else if (init?.body instanceof URLSearchParams) {
      call.body = init.body.toString();
      call.form = Object.fromEntries(init.body.entries());
    }
    calls.push(call);
    for (const [match, respond] of routes) if (match(url, init)) return respond(call);
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
  };
  return { fetch: fetchImpl, calls };
}

export const samplePost: OutboxPost = {
  id: "item-1",
  idempotencyKey: "idem-1",
  platform: "instagram",
  mediaUrl: "https://media.example/clip.mp4",
  caption: "My lats are not a fan of this pull day…\n\n#gym #gymbro #hypertrophy",
  scheduledFor: "2026-12-01T09:00:00Z",
  status: "publishing",
  attempts: 0,
};

/** Deep search for any location-ish key in a recorded body (the location boundary test). */
export function hasLocationKey(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  return Object.entries(v as Record<string, unknown>).some(([k, val]) => /location|recordingDetails|place/i.test(k) || hasLocationKey(val));
}
