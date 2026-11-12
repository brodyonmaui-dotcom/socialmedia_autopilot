import type { PostStatus } from "../types.js";

/**
 * Retry policy (non-negotiable #3): bounded attempts, backoff between them, and a hard rule that a
 * timeout is "unknown" — never retried by the engine, because the platform may have accepted it.
 */
export interface RetryPolicy {
  /** Total publish attempts per post, including the first. */
  maxAttempts: number;
  /** Backoff before attempt 2; later waits multiply by `factor` up to `maxBackoffMs`. */
  baseBackoffMs: number;
  factor: number;
  maxBackoffMs: number;
  /** A publish call that runs longer than this is abandoned and recorded as "unknown". */
  publishTimeoutMs: number;
  /** Same deadline for the existence check; a check that times out is retried later (it sends nothing). */
  lookupTimeoutMs: number;
}

/** 4 attempts over roughly 5 + 15 + 45 min ≈ 65 min; a post that still fails after that is alerted. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseBackoffMs: 5 * 60_000,
  factor: 3,
  maxBackoffMs: 60 * 60_000,
  publishTimeoutMs: 5 * 60_000,
  lookupTimeoutMs: 60_000,
};

/** Wait before the next attempt, given how many attempts have already been made (>= 1). Deterministic, no jitter. */
export function backoffMs(attemptsSoFar: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  const n = Math.max(1, attemptsSoFar);
  return Math.min(policy.maxBackoffMs, Math.round(policy.baseBackoffMs * policy.factor ** (n - 1)));
}

export type FailureClass = "timeout" | "rejected" | "permanent";

/**
 * A rejection no retry can fix (bad caption, missing permission, location field, assisted platform):
 * the engine marks the post failed and alerts at once instead of burning the retry budget.
 */
export class NonRetryableError extends Error {
  override readonly name = "NonRetryableError";
}

/** The error thrown when the engine's own deadline passes. */
export class PublishTimeoutError extends Error {
  override readonly name = "TimeoutError";
  constructor(ms: number) {
    super(`publish exceeded ${ms} ms — outcome unknown`);
  }
}

/**
 * Network failures and timeouts mean we don't know whether the platform acted. Everything else is a
 * deliberate rejection (4xx, validation, quota) where the platform told us nothing was created.
 */
export function classifyFailure(err: unknown): FailureClass {
  if (err instanceof NonRetryableError || (err as { name?: string } | undefined)?.name === "NonRetryableError") return "permanent";
  if (err instanceof PublishTimeoutError) return "timeout";
  if (err instanceof TypeError) return "timeout"; // undici: fetch network failure
  const name = (err as { name?: string } | undefined)?.name;
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  const code = (err as { code?: string } | undefined)?.code;
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") return "timeout";
  return "rejected";
}

export type Decision =
  | { status: "published"; attempts: number; alert: false }
  | { status: "queued"; attempts: number; nextAttemptAt: string; alert: false }
  | { status: "failed"; attempts: number; alert: true }
  | { status: "unknown"; attempts: number; alert: true };

/**
 * Pure state transition after one attempt. `attemptsBefore` is the count before this attempt.
 *  - success        → published
 *  - rejected       → queued with backoff, or failed (+ alert) once maxAttempts is reached
 *  - permanent      → failed (+ alert) at once
 *  - timeout        → unknown (+ alert); never queued again by the engine
 */
export function decideAfterAttempt(
  outcome: { kind: "success" } | { kind: "failure"; cls: FailureClass },
  attemptsBefore: number,
  now: Date,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Decision {
  const attempts = attemptsBefore + 1;
  if (outcome.kind === "success") return { status: "published", attempts, alert: false };
  if (outcome.cls === "timeout") return { status: "unknown", attempts, alert: true };
  if (outcome.cls === "permanent" || attempts >= policy.maxAttempts) return { status: "failed", attempts, alert: true };
  return { status: "queued", attempts, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts, policy)).toISOString(), alert: false };
}

/** Statuses the engine may pick up. "unknown" and "failed" need a human; "publishing" is in flight. */
export const DUE_STATUSES: readonly PostStatus[] = ["approved", "queued"] as const;
