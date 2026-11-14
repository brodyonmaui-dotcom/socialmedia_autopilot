// Edge-safe: no node:crypto, no pg. The middleware only checks the cookie's shape; every page and
// action then validates the session against the DB with requireSession().

/** Same values as session.ts (a test keeps them in sync); duplicated so the Edge bundle stays DB-free. */
export const MW_SESSION_COOKIE = "ap_session";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Paths (relative to basePath /app) reachable without a session. sw.js is static and holds no data (F8). */
/** Single files: exact match only (so /sw.js.map, /sw.jsx, /sw.js/x are not public). */
const PUBLIC_FILES = ["/manifest.json", "/sw.js", "/favicon.ico"];
/** Directories: the path itself or anything under it ("/" boundary, so /iconsx is not public). */
const PUBLIC_PREFIXES = ["/login", "/_next/static", "/_next/image", "/icons"];

export function isPublicPath(path: string): boolean {
  return PUBLIC_FILES.includes(path) || PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

export function middlewareDecision(path: string, cookie: string | undefined): "pass" | "redirect" {
  if (isPublicPath(path)) return "pass";
  return typeof cookie === "string" && TOKEN_RE.test(cookie) ? "pass" : "redirect";
}
