import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(cmd, args, { maxBuffer: 1024 * 1024 * 64 });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    // ffmpeg exits non-zero for `-f null -` analysis runs even on success; stderr still has what we need.
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? e.message };
  }
}

export interface CheckedRun {
  stdout: string;
  stderr: string;
  /** Exit code (null when killed). */
  code: number | null;
  timedOut: boolean;
  /** The binary isn't installed (ENOENT). */
  missing: boolean;
}

/**
 * Like `run`, but reports how it ended: exit code, a time-box kill (`timeoutMs`, SIGKILL) and a missing
 * binary. Never throws. Used by the fix engine, which must tell "ffmpeg failed" from "ffmpeg hung".
 */
export async function runChecked(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<CheckedRun> {
  try {
    const r = await execFileAsync(cmd, args, { maxBuffer: 1024 * 1024 * 64, timeout: opts.timeoutMs ?? 0, killSignal: "SIGKILL" });
    return { stdout: r.stdout, stderr: r.stderr, code: 0, timedOut: false, missing: false };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string; code?: unknown; killed?: boolean; signal?: string | null };
    const missing = e.code === "ENOENT";
    const timedOut = !missing && !!e.killed && e.signal === "SIGKILL";
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message,
      code: typeof e.code === "number" ? e.code : null,
      timedOut,
      missing,
    };
  }
}

/** True when `<cmd> -version` runs (used to report "ffmpeg is not installed" once, in plain words). */
export async function hasBinary(cmd: string): Promise<boolean> {
  return !(await runChecked(cmd, ["-version"], { timeoutMs: 10_000 })).missing;
}
