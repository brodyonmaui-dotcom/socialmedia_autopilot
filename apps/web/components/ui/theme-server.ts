import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme, type Theme } from "./theme.js";

/** Server-only: the viewer's theme from the ds-theme cookie (default light = Day). Pass it to AppShell + ThemeToggle. */
export async function getTheme(): Promise<Theme> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}
