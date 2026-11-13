import Link from "next/link";
import { cx, FOCUS } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";

export type TopBarAction = { href?: string; label: string; icon?: IconName };

const ACCENT_BTN =
  "items-center justify-center bg-ds-accent text-ds-ink transition-colors duration-[var(--ds-dur-fast)] ease-ds hover:bg-ds-accent-hi";

function ActionEl({ action, className, size }: { action: TopBarAction; className: string; size: number }) {
  const icon = <Icon name={action.icon ?? "plus"} size={size} strokeWidth={2} />;
  return action.href ? (
    <Link href={action.href} aria-label={action.label} title={action.label} className={className}>
      {icon}
    </Link>
  ) : (
    <button type="submit" aria-label={action.label} title={action.label} className={className}>
      {icon}
    </button>
  );
}

/**
 * Page title (<h1>) + one primary action. Phone: sticky 56px bar, 24px title, 44px accent icon button.
 * Desktop: 38px thin title, search icon button + 48px accent "+". An action without `href` renders
 * a submit button (for use inside a form).
 */
export function TopBar({
  title,
  subtitle,
  action,
  search,
}: {
  title: string;
  subtitle?: string;
  action?: TopBarAction;
  search?: { href: string };
}) {
  return (
    <header className="sticky top-0 z-20 -mx-4 flex h-14 items-center gap-3 bg-ds-bg/90 px-4 backdrop-blur lg:static lg:mx-0 lg:h-auto lg:bg-transparent lg:px-0 lg:pb-6 lg:pt-8 lg:backdrop-blur-none">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[24px] font-normal leading-[1.1] tracking-[-0.015em] lg:text-[38px]">{title}</h1>
        {subtitle && <p className="mt-1 hidden truncate text-[15px] text-ds-muted lg:block">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {search && (
          <Link
            href={search.href}
            aria-label="Search"
            title="Search"
            className={cx(
              "hidden size-11 items-center justify-center rounded-ds-md bg-ds-raised text-ds-muted hover:text-ds-text lg:inline-flex",
              FOCUS,
            )}
          >
            <Icon name="search" size={20} />
          </Link>
        )}
        {action && (
          <>
            <ActionEl action={action} size={22} className={cx(ACCENT_BTN, "inline-flex size-11 rounded-ds-md lg:hidden", FOCUS)} />
            <ActionEl
              action={action}
              size={24}
              className={cx(ACCENT_BTN, "hidden size-12 rounded-ds-lg shadow-ds-glow lg:inline-flex", FOCUS)}
            />
          </>
        )}
      </div>
    </header>
  );
}
