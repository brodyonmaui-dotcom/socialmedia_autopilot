// Two-key run mode for the whole worker (run-2-decisions.md correction 6): real actions only when the
// dry-run key is off (DRY_RUN=false) AND the live key is present (argv flag or WORKER_LIVE=1).
// Anything else runs dry-run; `reason` names the missing key when only one of the two was given.

export const LIVE_FLAG = "--" + "live";

export interface RunMode {
  dryRun: boolean;
  /** true only when both keys are present (always === !dryRun). */
  live: boolean;
  reason: string | null;
}

export function resolveRunMode(env: Record<string, string | undefined>, argv: readonly string[]): RunMode {
  const dryKeyOff = env.DRY_RUN === "false";
  const liveKey = argv.includes(LIVE_FLAG) || env.WORKER_LIVE === "1";
  if (dryKeyOff && liveKey) return { dryRun: false, live: true, reason: null };
  if (dryKeyOff) {
    return { dryRun: true, live: false, reason: "live refused: DRY_RUN is false but no live key (pass the argv flag or WORKER_LIVE=1); running dry-run" };
  }
  if (liveKey) return { dryRun: true, live: false, reason: "live refused: live key present but DRY_RUN is not false; running dry-run" };
  return { dryRun: true, live: false, reason: null };
}
