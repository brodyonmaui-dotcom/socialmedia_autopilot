import type { ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { GridLines } from "./GridLines.js";
import type { IconName } from "./Icon.js";
import { NoiseOverlay } from "./NoiseOverlay.js";
import type { Platform } from "./PlatformLogo.js";
import { SiteHeader, type Brand, type HeaderCta } from "./SiteHeader.js";
import { TabBar } from "./TabBar.js";
import type { Theme } from "./theme.js";

export type NavItem = { id: string; label: string; href: string; icon: IconName; badge?: number };
/** v1 sidebar account row. Unused by the v2 frame; kept exported for compatibility. */
export type AccountRow = { label: string; value: string; tone?: "accent" | "warn" | "muted"; href?: string; platform?: Platform };

/**
 * Page frame (v2): `.ds-root` + noise + 12/4-column grid lines + sticky SiteHeader + `<main id="main">`
 * + optional footer + phone TabBar. Content below lg is padded so the tab bar never covers the footer.
 */
export function AppShell({
  nav,
  active,
  theme = "light",
  cta,
  primaryAction,
  footer,
  brand,
  homeHref,
  menu,
  children,
}: {
  nav: NavItem[];
  active: string;
  /** From getTheme() (theme-server.ts); ThemeToggle flips it client-side. Day ("light") by default. */
  theme?: Theme;
  cta?: HeaderCta;
  /** @deprecated v1 name for `cta`. */
  primaryAction?: HeaderCta;
  /** @deprecated v1 sidebar accounts; ignored by the v2 frame. */
  accounts?: AccountRow[];
  footer?: ReactNode;
  brand?: Brand;
  homeHref?: string;
  /** Header far-right slot (HeaderMenu). */
  menu?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ds-root relative min-h-dvh overflow-x-clip" data-theme={theme}>
      <a
        href="#main"
        className={cx(
          "sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:bg-ds-invert focus:px-4 focus:py-3 focus:font-bold focus:text-ds-on-invert",
          FOCUS,
        )}
      >
        Skip to content
      </a>
      <NoiseOverlay />
      <GridLines />
      <SiteHeader nav={nav} active={active} theme={theme} cta={cta ?? primaryAction} brand={brand} homeHref={homeHref} menu={menu} />
      <div className="relative z-10 pb-[calc(var(--ds-tabbar-h)+env(safe-area-inset-bottom))] lg:pb-0">
        <main id="main" tabIndex={-1} className="relative z-10 outline-none">
          {children}
        </main>
        {footer}
      </div>
      <TabBar nav={nav} active={active} />
    </div>
  );
}
