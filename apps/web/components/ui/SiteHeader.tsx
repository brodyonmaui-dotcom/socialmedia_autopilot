import Link from "next/link";
import type { ReactNode } from "react";
import type { NavItem } from "./AppShell.js";
import { cx, FOCUS } from "./cx.js";
import { CONTAINER } from "./GridLines.js";
import { Icon } from "./Icon.js";
import type { Theme } from "./theme.js";
import { ThemeToggle } from "./ThemeToggle.js";

export type Brand = { serif: string; sans: string };
export type HeaderCta = { href: string; label: string };

/** Self-contained pill (not Button) so the frame doesn't depend on control restyles. */
export const PILL_CTA =
  "inline-flex h-11 items-center justify-center rounded-full border border-ds-text px-5 ds-caps text-ds-text transition-colors duration-[var(--ds-dur)] ease-ds hover:bg-ds-text hover:text-ds-bg";

/** Wordmark: serif italic word + Inter 900 caps word. */
export function Logo({ brand }: { brand: Brand }) {
  return (
    <>
      <span className="ds-serif text-[22px] leading-none lg:text-[26px]">{brand.serif}</span>
      <span className="text-[18px] font-black leading-none tracking-[-0.04em] lg:text-[22px]">{brand.sans}</span>
    </>
  );
}

/**
 * Sticky top frame: desktop nav (first 5 items) left, centred wordmark, theme toggle + pill CTA right.
 * Below lg: theme toggle left, wordmark centre, round "+" CTA right (nav moves to TabBar).
 * `menu` (e.g. a HeaderMenu) sits at the far right on every width.
 */
export function SiteHeader({
  nav,
  active,
  theme,
  cta,
  brand = { serif: "run", sans: "MYSOCIALS" },
  homeHref = "/",
  menu,
}: {
  nav: NavItem[];
  active: string;
  theme: Theme;
  cta?: HeaderCta;
  brand?: Brand;
  homeHref?: string;
  /** Far-right slot, e.g. <HeaderMenu> with secondary links and logout. */
  menu?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-40 h-[var(--ds-header-h)] border-b border-ds-line bg-ds-bg/80 backdrop-blur-[10px]">
      <div className={cx(CONTAINER, "relative flex h-full items-center justify-between")}>
        <div className="flex items-center">
          <nav aria-label="Primary" className="hidden lg:block">
            <ul className="flex items-center gap-8">
              {nav.slice(0, 5).map((item) => {
                const isActive = item.id === active;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={cx(
                        "ds-caps inline-flex min-h-11 items-center gap-1.5 transition-colors duration-[var(--ds-dur)] ease-ds",
                        isActive
                          ? "text-ds-text underline decoration-ds-accent decoration-1 underline-offset-8"
                          : "text-ds-muted hover:text-ds-text",
                        FOCUS,
                      )}
                    >
                      {item.label}
                      {item.badge != null && item.badge > 0 && (
                        <span className="ds-num min-w-4 rounded-full bg-ds-accent px-1 text-center text-[10px] font-bold leading-4 tracking-normal text-ds-ink no-underline">
                          {item.badge}
                          <span className="sr-only"> new</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="lg:hidden">
            <ThemeToggle initial={theme} />
          </div>
        </div>

        <Link
          href={homeHref}
          className={cx(
            "absolute left-1/2 top-1/2 inline-flex min-h-11 -translate-x-1/2 -translate-y-1/2 items-baseline gap-0.5 text-ds-text",
            FOCUS,
          )}
        >
          <Logo brand={brand} />
          <span className="sr-only"> home</span>
        </Link>

        <div className="flex items-center gap-3">
          <div className="hidden lg:block">
            <ThemeToggle initial={theme} />
          </div>
          {cta && (
            <>
              <Link href={cta.href} className={cx(PILL_CTA.replace("inline-flex ", ""), "hidden lg:inline-flex", FOCUS)}>
                {cta.label}
              </Link>
              <Link
                href={cta.href}
                aria-label={cta.label}
                title={cta.label}
                className={cx(
                  "inline-flex size-11 items-center justify-center rounded-full border border-ds-text text-ds-text transition-colors duration-[var(--ds-dur)] ease-ds hover:bg-ds-text hover:text-ds-bg lg:hidden",
                  FOCUS,
                )}
              >
                <Icon name="plus" size={20} strokeWidth={2} />
              </Link>
            </>
          )}
          {menu}
        </div>
      </div>
    </header>
  );
}
