import type { Platform } from "@autopilot/core";
import type { FetchLike } from "../sources.js";

/** Shared bits of the account sources (read-only GETs, token in a header, never in the URL). */

export type Json = Record<string, unknown>;
export const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** A count as number or numeric string (YouTube sends strings). Anything else → null (missing ≠ 0). */
export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) return Number(v);
  return null;
}

/** The platform said "slow down": ends the run for that platform; what was read so far is kept. */
export class RateLimitError extends Error {
  constructor(platform: Platform, detail: string) {
    super(`${platform} account analytics: rate limited (${detail})`);
    this.name = "RateLimitError";
  }
}

/** The per-run request cap was reached: ends the run for that platform like a rate limit, without an alert. */
export class BudgetExhausted extends Error {
  constructor(platform: Platform, max: number) {
    super(`${platform} account analytics: request budget of ${max} used up`);
    this.name = "BudgetExhausted";
  }
}

export class AccountApiError extends Error {
  constructor(
    platform: Platform,
    readonly status: number,
    readonly code: number | null,
    message: string,
  ) {
    super(`${platform} account analytics: HTTP ${status}${code !== null ? ` code ${code}` : ""}${message ? ` ${message}` : ""}`);
    this.name = "AccountApiError";
  }
}

/** Counts requests against a fixed cap; every GET goes through here. */
export class BudgetedFetch {
  requests = 0;
  constructor(
    private readonly platform: Platform,
    private readonly fetchImpl: FetchLike,
    private readonly headers: Record<string, string>,
    readonly max: number,
  ) {}

  async get(url: string): Promise<{ status: number; body: unknown }> {
    if (this.requests >= this.max) throw new BudgetExhausted(this.platform, this.max);
    this.requests++;
    const res = await this.fetchImpl(url, { headers: this.headers });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }
}

/**
 * Captions/descriptions may tag other people. We never store other people's usernames, so @handles are
 * replaced before anything is stored or compared (the same rule runs on both sides of a caption match).
 */
export function stripMentions(text: string): string {
  return text.replace(/(^|[^\w])@[\w.]{1,30}/gu, "$1@…");
}

export function cleanText(v: unknown, max = 2200): string | null {
  if (typeof v !== "string") return null;
  const t = stripMentions(v).trim();
  if (!t) return null;
  return [...t].length > max ? [...t].slice(0, max).join("") : t;
}

/** ISO date-time or null. */
export function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
