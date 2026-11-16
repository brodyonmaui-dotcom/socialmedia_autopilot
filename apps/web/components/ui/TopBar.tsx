import type { ReactNode } from "react";
import { ButtonLink, Button } from "./Button.js";
import type { IconName } from "./Icon.js";
import { PageHeader } from "./PageHeader.js";

/** `href` → link; without it a submit button (for use inside a form). */
export type TopBarAction = { href?: string; label: string; icon?: IconName };

/**
 * @deprecated v2 page-title band, kept for pages not rebuilt yet. Renders a v3 PageHeader: the title and
 * the `serif` word in one display font (hard rule 1), `meta`/`subtitle` as the subtitle, one outline action.
 * `index` is ignored (no index labels in v3). New screens use PageHeader directly; the shell's top bar is AppTopBar.
 */
export function TopBar({
  title,
  serif,
  meta,
  action,
  subtitle,
  extra,
}: {
  index?: string;
  title: string;
  serif?: string;
  meta?: string;
  action?: TopBarAction;
  subtitle?: string;
  /** @deprecated ignored. */
  search?: { href: string };
  extra?: ReactNode;
}) {
  const act = action ? (
    action.href ? (
      <ButtonLink href={action.href} variant="outline">
        {action.label}
      </ButtonLink>
    ) : (
      <Button type="submit" variant="outline">
        {action.label}
      </Button>
    )
  ) : null;
  return (
    <PageHeader
      title={serif ? `${title} ${serif}` : title}
      subtitle={subtitle ?? meta}
      action={act || extra ? (
        <>
          {extra}
          {act}
        </>
      ) : undefined}
    />
  );
}
