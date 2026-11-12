import { CAPABILITIES, type Platform, type PlatformAdapter } from "@autopilot/core";
import { createInstagramAdapter, type InstagramAdapterConfig } from "./instagram.js";
import { createTikTokAdapter, type TikTokAdapterConfig } from "./tiktok.js";
import { createYouTubeAdapter, type YouTubeAdapterConfig } from "./youtube.js";
import type { FetchLike } from "./http.js";

export interface AdapterCredentials {
  instagram?: Omit<InstagramAdapterConfig, "fetch">;
  youtube?: Omit<YouTubeAdapterConfig, "fetch">;
  tiktok?: Omit<TikTokAdapterConfig, "fetch">;
  fetch?: FetchLike;
}

/** Builds the adapters whose credentials exist. Snapchat is assisted (scheduling "none") and never registered. */
export function buildAdapters(creds: AdapterCredentials): Partial<Record<Platform, PlatformAdapter>> {
  const adapters: Partial<Record<Platform, PlatformAdapter>> = {};
  if (creds.instagram) adapters.instagram = createInstagramAdapter({ ...creds.instagram, fetch: creds.fetch });
  if (creds.youtube) adapters.youtube = createYouTubeAdapter({ ...creds.youtube, fetch: creds.fetch });
  if (creds.tiktok) adapters.tiktok = createTikTokAdapter({ ...creds.tiktok, fetch: creds.fetch });
  for (const p of Object.keys(adapters) as Platform[]) {
    if (CAPABILITIES[p].scheduling === "none") delete adapters[p];
  }
  return adapters;
}

/** Reads adapter credentials from env vars (names match .env.example / the probes). Never logs values. */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): AdapterCredentials {
  return {
    instagram: env.META_ACCESS_TOKEN && env.IG_USER_ID ? { accessToken: env.META_ACCESS_TOKEN, igUserId: env.IG_USER_ID, graphVersion: env.META_GRAPH_VERSION } : undefined,
    youtube:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.YT_REFRESH_TOKEN
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, refreshToken: env.YT_REFRESH_TOKEN }
        : undefined,
    tiktok: env.ZERNIO_API_KEY && env.ZERNIO_TIKTOK_ACCOUNT_ID ? { apiKey: env.ZERNIO_API_KEY, accountId: env.ZERNIO_TIKTOK_ACCOUNT_ID } : undefined,
  };
}
