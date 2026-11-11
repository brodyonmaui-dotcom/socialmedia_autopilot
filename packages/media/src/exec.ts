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
