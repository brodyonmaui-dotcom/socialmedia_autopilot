import Link from "next/link";
import type { ReactNode } from "react";
import { approveAndSendAction, copyDraftAction, ignoreAccountAction, markHandledAction, notSpamAction, sendManualAction } from "../../app/inbox/actions.js";
import type { InboxFilter, InboxListRow } from "../../lib/inbox/list.js";
import { cardPlan, reasonChip, returnTab } from "../../lib/inbox/view.js";
import { Avatar, Badge, Button, ButtonLink, Chip, FOCUS, Icon, Menu, PLATFORM_NAME, PlatformLogo, cx, type MenuItem } from "../ui/index.js";
import { CopyButton } from "./CopyButton.js";
import { DmWindow } from "./DmWindow.js";
import { ReplyComposer } from "./ReplyComposer.js";

/** Instagram handles only: letters, digits, dot, underscore. Anything else gets no deep link. */
const IG_HANDLE = /^[A-Za-z0-9._]{1,30}$/;

/**
 * One inbox item, read top to bottom: who + where + when (and one reason chip), what they said, what we'd
 * reply, one solid button. Secondary actions sit beside it; rare ones in the ⋯ menu.
 */
export function InboxItemCard({ row, filter, now }: { row: InboxListRow; filter: InboxFilter; now: Date }) {
  const kind = row.kind === "dm" ? "dms" : "comments";
  const plan = cardPlan(row, filter);
  const chip = filter === "ignored" ? null : reasonChip(row.bucket, row.reason);
  const tab = returnTab(kind, filter);
  const fields = { tab, filter };
  const titleId = `item-${row.id}`;
  const platform = PLATFORM_NAME[row.platform] ?? row.platform;

  const menu: MenuItem[] = [];
  if (row.href) menu.push({ label: "Open", icon: "arrowUpRight", href: row.href });
  if (plan.canHide) menu.push({ label: "Hide on Instagram", icon: "eye", action: sendManualAction.bind(null, row.id, "hide"), fields, tone: "danger" });
  if (plan.canDismiss) menu.push({ label: "Dismiss without replying", icon: "check", action: markHandledAction.bind(null, row.id), fields });
  if (plan.canIgnoreAccount && filter !== "ignored") menu.push({ label: "Always ignore this account", icon: "x", action: ignoreAccountAction.bind(null, row.kind, row.id), fields });

  // The handle already opens the item; the menu only shows when it holds more than "Open".
  const more = menu.length > (row.href ? 1 : 0) ? <Menu label={`More for ${row.authorName}`} items={menu} /> : null;
  const igLink =
    row.kind === "dm" && row.authorHandle && IG_HANDLE.test(row.authorHandle) ? (
      <ButtonLink href={`https://ig.me/m/${row.authorHandle}`} target="_blank" rel="noopener noreferrer" variant="outline" size="sm">
        Open Instagram
        <Icon name="arrowUpRight" size={16} />
      </ButtonLink>
    ) : null;

  return (
    <li aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3 rounded-ds-lg border border-ds-line bg-ds-card p-4 lg:p-5">
      <div className="flex items-start gap-3">
        <Avatar name={row.authorName} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col">
          {row.href ? (
            <Link id={titleId} href={row.href} className={cx("-mx-1 self-start overflow-hidden text-ellipsis whitespace-nowrap rounded-ds-xs px-1 text-[15px] font-semibold text-ds-text hover:underline", FOCUS)}>
              {row.authorName}
            </Link>
          ) : (
            <p id={titleId} className="overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-semibold text-ds-text">
              {row.authorName}
            </p>
          )}
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ds-muted">
            <PlatformLogo platform={row.platform} size={13} className="shrink-0 text-ds-text" />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
              {platform}
              {row.kind === "dm" ? " DM" : ""} · {row.age}
            </span>
          </p>
        </div>
        {plan.status ? <Badge tone={plan.status.tone}>{plan.status.label}</Badge> : chip ? <Chip tone={chip.tone}>{chip.label}</Chip> : null}
      </div>

      <p className="whitespace-pre-wrap break-words text-[16px] leading-snug text-ds-text">{row.text || "(no text)"}</p>

      {plan.rule ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-snug text-ds-muted">
          <Icon name="alert" size={14} className="mt-px shrink-0 text-ds-warn" />
          {plan.rule}
        </p>
      ) : null}
      {plan.note ? <p className="text-[13px] leading-snug text-ds-muted">{plan.note}</p> : null}
      {row.kind === "dm" && (filter === "needs-you" || filter === "drafted") ? <DmWindow lastInboundAt={row.at} initialNow={now.toISOString()} /> : null}

      {plan.primary === "approve" || plan.primary === "write" ? (
        <ReplyComposer
          action={approveAndSendAction.bind(null, row.id)}
          mode={plan.primary}
          draft={row.draftedReply}
          tab={tab}
          filter={filter}
          extra={more}
        />
      ) : (
        <>
          {row.draftedReply ? (
            <div className="rounded-ds-sm bg-ds-raised px-3 py-2.5">
              <p className="ds-label text-ds-muted">{filter === "sent" ? (row.kind === "dm" ? "Copied draft" : "Your reply") : "Drafted reply"}</p>
              <p className="mt-1 whitespace-pre-wrap text-[15px] leading-snug text-ds-text">{row.draftedReply}</p>
            </div>
          ) : null}
          <ItemButtons>
            {plan.primary === "copy" && row.draftId && row.draftedReply ? (
              <CopyButton text={row.draftedReply} label="Copy draft" variant="solid" onCopied={copyDraftAction.bind(null, row.draftId)} />
            ) : null}
            {igLink}
            {plan.canNotSpam ? (
              <form action={notSpamAction.bind(null, row.kind, row.id)}>
                <input type="hidden" name="tab" value={tab} />
                <input type="hidden" name="filter" value={filter} />
                <Button type="submit" variant="outline" size="sm">
                  Not spam
                </Button>
              </form>
            ) : null}
            {filter === "ignored" && plan.canIgnoreAccount ? (
              <form action={ignoreAccountAction.bind(null, row.kind, row.id)}>
                <input type="hidden" name="tab" value={tab} />
                <input type="hidden" name="filter" value={filter} />
                <Button type="submit" variant="ghost" size="sm">
                  Always ignore this account
                </Button>
              </form>
            ) : null}
            {more}
          </ItemButtons>
        </>
      )}
    </li>
  );
}

function ItemButtons({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 empty:hidden">{children}</div>;
}
