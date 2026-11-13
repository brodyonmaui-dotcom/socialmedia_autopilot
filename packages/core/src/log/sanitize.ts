/**
 * One sanitiser for every string that leaves the process: log lines, `last_error`, alert messages
 * (stored, logged and shown in the UI), probe summaries. Platform error bodies and fetch errors can
 * echo request params, so anything token-shaped is cut down to its first 4 chars + a marker
 * (`EAAB…[redacted]`): enough to tell which credential it was, useless to anyone reading the log.
 * Idempotent: sanitising twice gives the same string. Dependency-free (scripts/ import it by path).
 */
export const REDACTED = "…[redacted]";

const keep4 = (v: string): string => (v.length >= 16 ? `${v.slice(0, 4)}${REDACTED}` : REDACTED);
const alreadyRedacted = (v: string): boolean => v.endsWith(REDACTED) || v.startsWith("…") || /^\[?REDACTED\]?$/i.test(v) || v === "***";

/** `name=value`, `name: value`, `"name":"value"` for secret-ish parameter names. */
const KEY_VALUE =
  /(?<![A-Za-z0-9])(access_token|refresh_token|id_token|client_secret|app_secret|api_key|apikey|x-api-key|password|secret|token|key)(["']?\s*[:=]\s*["']?)([^\s&"',;}<>)\]]+)/gi;
const BEARER = /\b(Bearer|Basic)(\s+)([A-Za-z0-9._~+/=-]+)/gi;
/** Known token shapes: Anthropic keys, Meta tokens, Google access + refresh tokens, sk_-style API keys (Zernio and friends). */
const SHAPES: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /EAA[A-Za-z0-9]{20,}/g,
  /ya29\.[A-Za-z0-9_-]+/g,
  /1\/\/[A-Za-z0-9_-]{20,}/g,
  /\b(?:sk|pk|rk)_(?:live_|test_)?[A-Za-z0-9]{16,}/g,
];
/** Long hex runs (40+), and long base64/base64url runs that look random (digit + upper + lower), so file paths survive. */
const HEX_RUN = /\b[0-9a-fA-F]{40,}\b/g;
const B64_RUN = /[A-Za-z0-9+/_-]{40,}={0,2}/g;
const looksRandom = (s: string): boolean => /\d/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s);

export function sanitizeForLog(s: string): string {
  let out = String(s);
  out = out.replace(BEARER, (m: string, scheme: string, sp: string, v: string, offset: number, all: string) =>
    alreadyRedacted(v) || all.startsWith("…", offset + m.length) ? m : `${scheme}${sp}${keep4(v)}`,
  );
  out = out.replace(KEY_VALUE, (m: string, k: string, sep: string, v: string) => (alreadyRedacted(v) || v.includes("[redacted") ? m : `${k}${sep}${keep4(v)}`));
  for (const re of SHAPES) out = out.replace(re, (m) => keep4(m));
  out = out.replace(HEX_RUN, (m) => keep4(m));
  out = out.replace(B64_RUN, (m) => (looksRandom(m) ? keep4(m) : m));
  return out;
}

/**
 * An error as one safe line: the message, plus the response body when it's a PlatformRequestError-like
 * object (`{ status, body }`), body truncated to 300 chars. Always through sanitizeForLog.
 */
export function sanitizeError(err: unknown): string {
  let msg: string;
  if (err instanceof Error) msg = err.message || err.name;
  else if (typeof err === "string") msg = err;
  else {
    try {
      msg = JSON.stringify(err) ?? String(err);
    } catch {
      msg = String(err);
    }
  }
  const body = err && typeof err === "object" && "body" in err ? (err as { body: unknown }).body : undefined;
  if (body !== undefined && body !== null) {
    let b: string;
    try {
      b = typeof body === "string" ? body : JSON.stringify(body);
    } catch {
      b = String(body);
    }
    // Sanitise before truncating, so a token cut in half at the limit can't slip past the shape rules.
    b = sanitizeForLog(b);
    if (b && b !== "{}" && !msg.includes(b)) msg = `${msg} · body: ${b.length > 300 ? `${b.slice(0, 300)}…` : b}`;
  }
  return sanitizeForLog(msg);
}
