// Fable to review
// Server only (Node runtime): the 60 s tick that calls runEditorAutoApprove. Started once per process from
// instrumentation.ts. The interval is unref'd (never keeps the process alive), ticks never overlap in-process
// (the advisory lock covers other processes), and a failure logs one line with the error name only (an error
// message can carry a connection string). Does nothing without DATABASE_URL or a valid TZ_CREATOR: caps and
// "today" are creator-zone rules, so the UTC fallback is not good enough to approve on.
import { creatorZone } from "../calendar/load.js";

export const AUTO_APPROVE_INTERVAL_MS = 60_000;
const STARTED = Symbol.for("autopilot.editorAutoApprove.started");

export interface TimerDeps {
  run: (now: Date, timeZone: string) => Promise<{ approved: number }>;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  intervalMs: number;
  setInterval: (fn: () => void, ms: number) => { unref?: () => unknown };
}

async function defaultRun(now: Date, timeZone: string) {
  const [{ getPool }, { runEditorAutoApprove }] = await Promise.all([import("../db.js"), import("./auto-approve-run.js")]);
  return runEditorAutoApprove(getPool(), now, timeZone);
}

/** Returns the tick (for tests) or null when it didn't start. Idempotent per process (dev reloads register twice). */
export function startEditorAutoApprove(over: Partial<TimerDeps> = {}): (() => Promise<void>) | null {
  const d: TimerDeps = { run: defaultRun, env: process.env, log: (l) => console.log(l), intervalMs: AUTO_APPROVE_INTERVAL_MS, setInterval: (fn, ms) => setInterval(fn, ms), ...over };
  const g = globalThis as Record<symbol, unknown>;
  if (!over.run && g[STARTED]) return null;
  if (!d.env.DATABASE_URL) {
    d.log("[editor-auto-approve] off: DATABASE_URL not set");
    return null;
  }
  const zone = creatorZone(d.env);
  if (zone.source !== "env") {
    d.log("[editor-auto-approve] off: TZ_CREATOR not set or invalid");
    return null;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await d.run(new Date(), zone.timeZone);
      if (r.approved > 0) d.log(`[editor-auto-approve] approved ${r.approved}`);
    } catch (err) {
      d.log(`[editor-auto-approve] failed: ${err instanceof Error ? err.name : "error"}`);
    } finally {
      running = false;
    }
  };
  const t = d.setInterval(() => void tick(), d.intervalMs);
  t.unref?.();
  if (!over.run) g[STARTED] = true;
  return tick;
}
