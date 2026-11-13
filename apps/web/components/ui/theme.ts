/** Theme choice for `.ds-root`. Pure helpers, safe on server and client. */
export type Theme = "light" | "dark";

/** Cookie the ThemeToggle writes and pages read (via getTheme in theme-server.ts). Not sensitive. */
export const THEME_COOKIE = "ds-theme";

/** Day ("light") is the default; only an explicit "dark" opts into Night. */
export function parseTheme(value: string | null | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

export function otherTheme(t: Theme): Theme {
  return t === "dark" ? "light" : "dark";
}

/** Cookie string for one year, whole app (basePath-independent path "/"). */
export function themeCookie(t: Theme): string {
  return `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
}
