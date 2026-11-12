import { getJson, type FetchLike } from "./http.js";

/**
 * Token health, read-only. Facts from research.md:
 *  - Meta Page token: never expires, but DATA ACCESS lapses every 90 days (until 2027-02-08 as of M0);
 *    the worker must alert 7 days ahead (re-run probe:connect-meta). debug_token gives both dates.
 *  - YouTube: a refresh token that returns invalid_grant is dead (re-run probe:yt).
 *  - Zernio: the TikTok account must still be connected (GET /v1/accounts).
 * Never logs a token value; the report carries only dates, scopes and booleans.
 */
export type TokenHealthLevel = "ok" | "warn" | "fail" | "skipped";

export interface TokenHealth {
  service: "meta" | "youtube" | "zernio";
  level: TokenHealthLevel;
  summary: string;
  expiresAt?: string;
  dataAccessExpiresAt?: string;
  daysLeft?: number;
  missingScopes?: string[];
  checkedAt: string;
}

export interface TokenHealthConfig {
  fetch?: FetchLike;
  now?: () => Date;
  /** Alert this many days before data access / expiry lapses (research.md: 7). */
  warnDays?: number;
  meta?: { appId: string; appSecret: string; accessToken: string; graphVersion?: string; wantedScopes?: string[] };
  youtube?: { clientId: string; clientSecret: string; refreshToken: string };
  zernio?: { apiKey: string; tiktokAccountId?: string; baseUrl?: string };
}

/** The 8 scopes probe:connect-meta asks for (M0 result: all granted). */
export const META_WANTED_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "instagram_manage_messages",
  "business_management",
];

const DAY = 86_400_000;

export async function checkMetaToken(cfg: NonNullable<TokenHealthConfig["meta"]>, opts: TokenHealthConfig): Promise<TokenHealth> {
  const fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
  const now = opts.now?.() ?? new Date();
  const warnDays = opts.warnDays ?? 7;
  const version = cfg.graphVersion ?? "v25.0";
  const appToken = `${cfg.appId}|${cfg.appSecret}`;
  const r = await getJson<{ data?: { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; type?: string; error?: { message?: string } }; error?: { message?: string } }>(
    fetchImpl,
    `https://graph.facebook.com/${version}/debug_token?input_token=${encodeURIComponent(cfg.accessToken)}&access_token=${encodeURIComponent(appToken)}`,
  );
  const d = r.body.data;
  const checkedAt = now.toISOString();
  if (!d || r.status >= 300) return { service: "meta", level: "fail", summary: `debug_token failed: ${r.body.error?.message ?? `HTTP ${r.status}`}`, checkedAt };
  if (!d.is_valid) return { service: "meta", level: "fail", summary: `token invalid: ${d.error?.message ?? "re-run probe:connect-meta"}`, checkedAt };
  const wanted = cfg.wantedScopes ?? META_WANTED_SCOPES;
  const missingScopes = wanted.filter((s) => !(d.scopes ?? []).includes(s));
  const expiresAt = d.expires_at ? new Date(d.expires_at * 1000).toISOString() : undefined;
  const dataAccessExpiresAt = d.data_access_expires_at ? new Date(d.data_access_expires_at * 1000).toISOString() : undefined;
  const deadlines = [expiresAt, dataAccessExpiresAt].filter((x): x is string => !!x).map((x) => Date.parse(x));
  const soonest = deadlines.length ? Math.min(...deadlines) : undefined;
  const daysLeft = soonest !== undefined ? Math.floor((soonest - now.getTime()) / DAY) : undefined;
  let level: TokenHealthLevel = "ok";
  const notes: string[] = [`${d.type ?? "token"} ok`];
  if (missingScopes.length) {
    level = "fail";
    notes.push(`missing scopes: ${missingScopes.join(", ")}`);
  }
  if (daysLeft !== undefined) {
    if (daysLeft < 0) {
      level = "fail";
      notes.push(`data access / token lapsed ${-daysLeft} day(s) ago`);
    } else if (daysLeft <= warnDays) {
      if (level === "ok") level = "warn";
      notes.push(`data access lapses in ${daysLeft} day(s): re-run probe:connect-meta`);
    } else notes.push(`data access until ${(dataAccessExpiresAt ?? expiresAt)!.slice(0, 10)} (${daysLeft} days)`);
  } else notes.push("no expiry reported");
  return { service: "meta", level, summary: notes.join(" · "), expiresAt, dataAccessExpiresAt, daysLeft, missingScopes, checkedAt };
}

export async function checkYouTubeToken(cfg: NonNullable<TokenHealthConfig["youtube"]>, opts: TokenHealthConfig): Promise<TokenHealth> {
  const fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
  const checkedAt = (opts.now?.() ?? new Date()).toISOString();
  const r = await getJson<{ access_token?: string; expires_in?: number; error?: string; error_description?: string }>(fetchImpl, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: cfg.refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token" }),
  });
  if (r.body.access_token) return { service: "youtube", level: "ok", summary: "refresh token ok", checkedAt };
  const dead = r.body.error === "invalid_grant";
  return { service: "youtube", level: "fail", summary: `${dead ? "refresh token revoked/expired" : "token refresh failed"}: ${r.body.error_description ?? r.body.error ?? `HTTP ${r.status}`} — re-run probe:yt`, checkedAt };
}

export async function checkZernioAccount(cfg: NonNullable<TokenHealthConfig["zernio"]>, opts: TokenHealthConfig): Promise<TokenHealth> {
  const fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
  const checkedAt = (opts.now?.() ?? new Date()).toISOString();
  const base = cfg.baseUrl ?? "https://zernio.com/api/v1";
  const r = await getJson<any>(fetchImpl, `${base}/accounts`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
  if (r.status >= 300) return { service: "zernio", level: "fail", summary: `accounts failed: HTTP ${r.status} ${r.body?.error?.message ?? r.body?.message ?? ""}`.trim(), checkedAt };
  const accounts: any[] = r.body?.accounts ?? r.body?.data ?? (Array.isArray(r.body) ? r.body : []);
  const tt = accounts.find((a) => a.platform === "tiktok" && (!cfg.tiktokAccountId || (a._id ?? a.id) === cfg.tiktokAccountId));
  if (!tt) return { service: "zernio", level: "fail", summary: `TikTok account ${cfg.tiktokAccountId ?? ""} not connected (${accounts.length} account(s) listed)`.replace("  ", " "), checkedAt };
  const status = tt.status ?? tt.connectionStatus;
  const needsReauth = typeof status === "string" && /expired|disconnected|error|reauth/i.test(status);
  return { service: "zernio", level: needsReauth ? "fail" : "ok", summary: `tiktok @${tt.username ?? tt.displayName ?? "?"} ${needsReauth ? `needs reconnecting (${status})` : "connected"}`, checkedAt };
}

/** Runs every configured check; unconfigured services are "skipped" (dry-run / cloud sessions have no tokens). */
export async function checkTokenHealth(cfg: TokenHealthConfig): Promise<TokenHealth[]> {
  const checkedAt = (cfg.now?.() ?? new Date()).toISOString();
  const out: TokenHealth[] = [];
  const guard = async (service: TokenHealth["service"], run: () => Promise<TokenHealth>): Promise<void> => {
    try {
      out.push(await run());
    } catch (err) {
      out.push({ service, level: "fail", summary: `check errored: ${(err as Error).message}`, checkedAt });
    }
  };
  if (cfg.meta) await guard("meta", () => checkMetaToken(cfg.meta!, cfg));
  else out.push({ service: "meta", level: "skipped", summary: "not configured", checkedAt });
  if (cfg.youtube) await guard("youtube", () => checkYouTubeToken(cfg.youtube!, cfg));
  else out.push({ service: "youtube", level: "skipped", summary: "not configured", checkedAt });
  if (cfg.zernio) await guard("zernio", () => checkZernioAccount(cfg.zernio!, cfg));
  else out.push({ service: "zernio", level: "skipped", summary: "not configured", checkedAt });
  return out;
}

export function formatTokenHealth(report: TokenHealth[]): string {
  return report.map((r) => `${r.service}=${r.level}${r.level === "ok" || r.level === "skipped" ? "" : ` (${r.summary})`}`).join(" · ");
}
