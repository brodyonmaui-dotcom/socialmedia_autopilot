import type { FoundFile } from "./scan.js";

/**
 * The ingest loop, with every side effect injected so it can be tested without a DB, R2 or
 * ffmpeg. index.ts wires the real ones.
 *
 * Connection loss (the SSH tunnel or the DB going away) is treated differently from a bad file:
 * a bad file is logged and skipped; a lost connection gets a bounded reconnect check, and if the
 * DB is still unreachable the run STOPS with one clear line instead of failing every remaining
 * file. Re-running is safe: finished clips are skipped by content hash, and the R2 key is the hash.
 */

const CONNECTION = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENOTCONN|Connection terminated|terminated unexpectedly|Client has encountered a connection error|connection error|server closed the connection|read ECONNRESET|socket hang up/i;

/** True for errors that mean "the database connection is gone", not "this file is bad". */
export function isConnectionError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; errors?: unknown[] } | null;
  if (!e) return false;
  if (CONNECTION.test(`${String(e.code ?? "")} ${String(e.message ?? "")}`)) return true;
  // pg wraps multi-address failures (::1 and 127.0.0.1) in an AggregateError with an EMPTY message.
  return Array.isArray(e.errors) && e.errors.some((x) => isConnectionError(x));
}

export interface IngestDeps {
  files: FoundFile[];
  dryRun: boolean;
  hash(path: string): Promise<string>;
  /** True when a media row with this content hash exists. */
  exists(hash: string): Promise<boolean>;
  /** QA + touch-up + upload + insert for one new file. Returns the line to log. */
  ingest(file: FoundFile, hash: string): Promise<string>;
  /** Cheap liveness check (`select 1`). */
  ping(): Promise<void>;
  log(line: string): void;
  sleep?(ms: number): Promise<void>;
  reconnectAttempts?: number;
  reconnectBaseMs?: number;
}

export interface IngestSummary {
  ingested: number;
  skipped: number;
  failed: number;
  stopped: boolean;
  /** Files never reached because the run stopped. */
  remaining: number;
}

const name = (p: string) => p.split(/[\\/]/).pop() ?? p;

export async function runIngest(d: IngestDeps): Promise<IngestSummary> {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = d.reconnectAttempts ?? 3;
  const baseMs = d.reconnectBaseMs ?? 5000;
  const s: IngestSummary = { ingested: 0, skipped: 0, failed: 0, stopped: false, remaining: 0 };
  const seen = new Set<string>();

  /** Bounded reconnect check. True = DB is back, retry the file once. */
  async function reconnect(): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      await sleep(baseMs * 2 ** i);
      try {
        await d.ping();
        d.log(`RECONNECTED after ${i + 1} check(s)`);
        return true;
      } catch {
        /* still down */
      }
    }
    return false;
  }

  async function one(file: FoundFile): Promise<void> {
    const hash = await d.hash(file.path);
    if (seen.has(hash) || (await d.exists(hash))) {
      d.log(`SKIP dup ${name(file.path)}`);
      s.skipped++;
      return;
    }
    if (d.dryRun) {
      d.log(`WOULD INGEST ${name(file.path)} · ${file.pillar}`);
    } else {
      d.log(await d.ingest(file, hash));
    }
    // Only after success: a failed attempt must not make its own retry look like a duplicate.
    seen.add(hash);
    s.ingested++;
  }

  for (let i = 0; i < d.files.length; i++) {
    const file = d.files[i]!;
    try {
      await one(file);
    } catch (err) {
      if (!isConnectionError(err)) {
        d.log(`ERROR ${name(file.path)} — ${(err as Error).message}`);
        s.failed++;
        continue;
      }
      d.log(`CONNECTION LOST at ${name(file.path)} — checking the database (${attempts} tries)`);
      if (await reconnect()) {
        try {
          await one(file);
        } catch (err2) {
          // The DB answered the ping, so this is about the file (or R2's network), not the tunnel:
          // count it and keep going rather than stopping the whole run.
          d.log(`ERROR ${name(file.path)} — ${(err2 as Error).message || String(err2)}`);
          s.failed++;
        }
        continue;
      }
      s.stopped = true;
      s.remaining = d.files.length - i;
      break;
    }
  }
  return s;
}

export function summaryLine(s: IngestSummary, dryRun: boolean): string {
  if (s.stopped) {
    return (
      `ingest: STOPPED — database connection lost (tunnel down?). ${s.ingested} ${dryRun ? "would be ingested" : "ingested"}, ` +
      `${s.skipped} skipped, ${s.failed} failed, ${s.remaining} not reached. Safe to re-run: finished clips are skipped by hash.`
    );
  }
  return dryRun
    ? `ingest (dry run): ${s.ingested} would be ingested, ${s.skipped} skipped (dup), ${s.failed} failed`
    : `ingest: ${s.ingested} ingested, ${s.skipped} skipped (dup), ${s.failed} failed`;
}
