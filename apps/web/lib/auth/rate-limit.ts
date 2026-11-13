import type { AuthStore } from "./store.js";

export const FAILURE_WINDOW_MS = 15 * 60_000;
export const MAX_FAILURES = 10;

export class RateLimitedError extends Error {
  constructor(message = "Too many failed attempts; try again in 15 minutes") {
    super(message);
    this.name = "RateLimitedError";
  }
}

/** Global (single-user) limit: refuse once MAX_FAILURES failures happened inside the window. */
export async function assertNotRateLimited(store: AuthStore, now = new Date()): Promise<void> {
  const n = await store.countFailures(new Date(now.getTime() - FAILURE_WINDOW_MS));
  if (n >= MAX_FAILURES) throw new RateLimitedError();
}

/** Records a failure; alerts once, when the window count reaches exactly MAX_FAILURES. */
export async function recordAuthFailure(
  store: AuthStore,
  kind: "login" | "register" | "enroll-code",
  now: Date,
  onAlert: (message: string) => Promise<void>,
): Promise<void> {
  await store.recordFailure(kind, now);
  const n = await store.countFailures(new Date(now.getTime() - FAILURE_WINDOW_MS));
  if (n === MAX_FAILURES) {
    await onAlert(
      `Auth: ${MAX_FAILURES} failed login/enrol attempts in 15 min (last: ${kind}); sign-in is paused until the window clears.`,
    );
  }
}
