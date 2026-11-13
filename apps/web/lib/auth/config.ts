export interface AuthConfig {
  rpID: string;
  origin: string;
  rpName: "runmysocials";
  secureCookie: boolean;
}

/**
 * WebAuthn relying party + cookie settings. Production: DOMAIN (from .env) is the rpID and the
 * only accepted origin. Dev: localhost, origin WEB_ORIGIN or http://localhost:3100.
 */
export function authConfigFromEnv(env: Record<string, string | undefined> = process.env): AuthConfig {
  const domain = env.DOMAIN?.trim();
  if (domain) return { rpID: domain, origin: `https://${domain}`, rpName: "runmysocials", secureCookie: true };
  if (env.NODE_ENV === "production") throw new Error("DOMAIN is not set: passkey login needs it in production");
  return { rpID: "localhost", origin: env.WEB_ORIGIN?.trim() || "http://localhost:3100", rpName: "runmysocials", secureCookie: false };
}
