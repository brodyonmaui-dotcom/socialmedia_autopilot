import Link from "next/link";
import { ButtonLink, Icon, PlatformLogo, cx, FOCUS } from "../ui/index.js";
import { sourceGlyph } from "../../lib/alerts/view.js";
import type { LiveRow } from "../../lib/alerts/live.js";

/** One live Inbox row (F20): the whole row opens the work in the Inbox, the button is the action. Nothing to acknowledge: it clears when handled. */
export function LiveInboxRow({ row, when }: { row: LiveRow; when: string }) {
  const src = sourceGlyph(row.platform);
  const headingId = `live-${row.id}`;
  return (
    <li aria-labelledby={headingId} className="relative flex flex-col gap-2 border-l-4 border-ds-accent py-4 pl-3 first:pt-0 last:pb-0">
      <h3 id={headingId} className="text-[15px] font-semibold leading-snug text-ds-text">
        <Link href={row.href} className={cx("break-words after:absolute after:inset-0 after:content-['']", FOCUS)}>
          {row.title}
        </Link>
      </h3>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ds-muted">
        <span className="font-semibold">Inbox</span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1.5">
          {src.platform ? <PlatformLogo platform={src.platform} size={14} className="text-ds-text" /> : <Icon name="settings" size={14} />}
          {src.label}
        </span>
        <span aria-hidden="true">·</span>
        <span className="ds-num">{when}</span>
      </p>
      <div className="relative z-10 mt-1 flex flex-wrap gap-2">
        <ButtonLink href={row.href} variant="solid" size="sm">
          {row.action}
        </ButtonLink>
      </div>
    </li>
  );
}
