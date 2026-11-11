/**
 * Bounded retry for transient network/TLS failures. Only for idempotent steps: the R2 upload
 * key is the content hash, so re-sending the same object can't create a duplicate.
 */
const TRANSIENT = /ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|EAI_AGAIN|socket hang up|bad record mac|TLS|network|fetch failed|timeout/i;

export function isTransient(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; name?: unknown } | null;
  return TRANSIENT.test(`${String(e?.code ?? "")} ${String(e?.name ?? "")} ${String(e?.message ?? err)}`);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; sleep?: (ms: number) => Promise<void>; onRetry?: (attempt: number, err: unknown) => void } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 2000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isTransient(err)) throw err;
      opts.onRetry?.(attempt, err);
      await sleep(baseMs * 2 ** (attempt - 1));
    }
  }
}
