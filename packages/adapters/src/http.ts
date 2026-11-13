import { NonRetryableError } from "@autopilot/core";

/** Injected so contract tests run on recorded fixtures and never touch the network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** A platform said no (HTTP >= 300 with a parsed body). Retryable unless the caller decides otherwise. */
export class PlatformRequestError extends Error {
  constructor(
    readonly platform: string,
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "PlatformRequestError";
  }
}

/**
 * The platform may have acted but we can't tell (e.g. an error after the upload bytes started flowing).
 * Named "TimeoutError" so the outbox's classifyFailure treats it as timeout-class → "unknown" + alert,
 * never retried (non-negotiable #3: a timeout is "unknown", not "failed").
 */
export class UploadAmbiguousError extends Error {
  override readonly name = "TimeoutError";
  constructor(
    readonly platform: string,
    message: string,
    readonly status?: number,
    readonly body?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface JsonResult<T> {
  status: number;
  body: T;
  headers: Headers;
}

/**
 * fetch + JSON parse with the engine's abort signal threaded through. Network failures propagate as
 * thrown TypeErrors (undici), which the outbox classifies as "unknown"; never swallow them here.
 */
export async function getJson<T = any>(fetchImpl: FetchLike, url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<JsonResult<T>> {
  const res = await fetchImpl(url, { ...init, ...(signal ? { signal } : {}) });
  const text = await res.text();
  let body: T;
  try {
    body = (text ? JSON.parse(text) : {}) as T;
  } catch {
    body = { raw: text } as T;
  }
  return { status: res.status, body, headers: res.headers };
}

/** Non-negotiable #5: adapters never send a location field. Checked on every outgoing body. */
const LOCATION_FIELDS = [
  "location_id", "location", "recordingDetails", "locationDescription", "locationTags", "location_tags", "placeId", "place_id", "place",
  "geo", "geolocation", "coordinates", "latitude", "longitude", "lat", "lng", "lon", "gps", "poi_id", "venue",
];
/** Exact key match (never substring: `allocation` is fine), case-insensitive. */
const LOCATION_KEYS = new Set(LOCATION_FIELDS.map((k) => k.toLowerCase()));
export function assertNoLocationFields(platform: string, body: Record<string, unknown>): void {
  const seen: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (!v || typeof v !== "object") return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (LOCATION_KEYS.has(k.toLowerCase())) seen.push(path ? `${path}.${k}` : k);
      walk(val, path ? `${path}.${k}` : k);
    }
  };
  walk(body, "");
  if (seen.length) throw new NonRetryableError(`${platform}: refusing to send location field(s) ${seen.join(", ")} (CLAUDE.md location boundary)`);
}

/** Hashtags in a caption ("#tag" tokens). */
export function countHashtags(caption: string): number {
  return (caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export function redactToken(s: string): string {
  return s.replace(/(access_token|token|key)=([^&\s]+)/gi, "$1=***");
}
