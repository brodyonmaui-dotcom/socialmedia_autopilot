// Edge-safe: no node:crypto, no pg. The middleware only checks the cookie's shape; every page and
// action then validates the session against the DB with requireSession().

/** Same values as session.ts (a test keeps them in sync); duplicated so the Edge bundle stays DB-free. */
export const MW_SESSION_COOKIE = "ap_session";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Paths (relative to basePath /app) reachable without a session. sw.js is static and holds no data (F8). */
const PUBLIC_PREFIXES = ["/login", "/_next/static", "/_next/image", "/manifest.json", "/sw.js", "/favicon.ico", "/icons"];

export function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

export function middlewareDecision(path: string, cookie: string | undefined): "pass" | "redirect" {
  if (isPublicPath(path)) return "pass";
  return typeof cookie === "string" && TOKEN_RE.test(cookie) ? "pass" : "redirect";
}
