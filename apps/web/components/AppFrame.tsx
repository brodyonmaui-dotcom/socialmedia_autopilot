import type { ReactNode } from "react";
import { logoutAction, logoutEverywhereAction } from "../app/login/actions.js";
import { getPool } from "../lib/db.js";
import { buildNav, moreLinks, tabFor, type FrameCounts, type MoreLink, type Section } from "./app-nav.js";
import { loadFrameCounts } from "./frame-counts.js";
import { AppShell, Badge, Button, HeaderMenu, Icon, ListRow, ListRows, type HeaderCta } from "./ui/index.js";
import { getTheme } from "./ui/theme-server.js";

export type { FrameCounts, Section } from "./app-nav.js";

/** Icon square used as the ListRow avatar for app destinations (menu + /more). */
export function DestinationIcon({ link }: { link: Pick<MoreLink, "icon"> }) {
  return (
    <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center border border-ds-line text-ds-text">
      <Icon name={link.icon} size={20} />
    </span>
  );
}

/** ListRows of the More destinations (shared by the header menu and the /more page). */
export function MoreList({ links, label = "More pages" }: { links: MoreLink[]; label?: string }) {
  return (
    <ListRows label={label}>
      {links.map((l) => (
        <ListRow
          key={l.id}
          avatar={<DestinationIcon link={l} />}
          title={l.label}
          subtitle={l.hint}
          href={l.href}
          trailing={l.badge ? <Badge tone="accent">{l.badge} open</Badge> : <Icon name="chevronRight" size={18} className="text-ds-muted" />}
        />
      ))}
    </ListRows>
  );
}

function MenuPanel({ links }: { links: MoreLink[] }) {
  return (
    <div className="px-[var(--ds-gutter)] pb-6 lg:px-6">
      <p className="ds-caps pt-6 text-ds-muted">More</p>
      <MoreList links={links} label="More pages" />
      <div className="mt-4 border-t border-ds-line pt-6">
        <p className="ds-caps text-ds-muted">Account</p>
        <form action={logoutAction} className="mt-4">
          <Button type="submit" variant="outline" block>
            <Icon name="logout" size={18} />
            Log out
          </Button>
        </form>
        <details className="group mt-3">
          <summary className="ds-caps flex min-h-11 cursor-pointer list-none items-center justify-between text-ds-muted hover:text-ds-text [&::-webkit-details-marker]:hidden">
            Lost a phone?
            <Icon name="chevronDown" size={16} className="transition-transform duration-[var(--ds-dur)] ease-ds group-open:rotate-180" />
          </summary>
          <p className="ds-note mt-1">
            Signs out every device, revokes every passkey and turns off push notifications on every device. You&apos;ll need to re-enrol on the server afterwards.
          </p>
          <form action={logoutEverywhereAction} className="mt-4">
            <Button type="submit" variant="outline" tone="danger" block>
              Log out everywhere
            </Button>
          </form>
        </details>
      </div>
    </div>
  );
}

/**
 * The app frame every signed-in page uses: AppShell (header, grid lines, noise, phone TabBar) with the real
 * nav, badge counts, and a header menu holding the More links and logout.
 * Pages still call requireSession() themselves before rendering this.
 *
 * - `active`: "home" | "batches" | "inbox" | "analytics" | "more" | "alerts" | "handoff" | "library" | "touch-up" | "research".
 *   More pages light the More tab.
 * - `counts`: pass them if the page already queried them (Home does) to skip the frame's own three count queries.
 */
export async function AppFrame({
  active,
  children,
  footer,
  cta,
  counts,
}: {
  active: Section | (string & {});
  children: ReactNode;
  /** Usually a <FooterBand>; rendered under <main>, above the tab-bar padding. */
  footer?: ReactNode;
  /** Header pill (desktop) / round "+" (phone). */
  cta?: HeaderCta;
  counts?: FrameCounts;
}) {
  const [theme, c] = await Promise.all([getTheme(), counts ? Promise.resolve(counts) : loadFrameCounts(getPool())]);
  const links = moreLinks(c);
  return (
    <AppShell
      theme={theme}
      nav={buildNav(c)}
      active={tabFor(active)}
      cta={cta}
      footer={footer}
      menu={
        <HeaderMenu>
          <MenuPanel links={links} />
        </HeaderMenu>
      }
    >
      {children}
    </AppShell>
  );
}
