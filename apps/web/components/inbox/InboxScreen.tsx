import Link from "next/link";
import { AppFrame } from "../AppFrame.js";
import { getPool } from "../../lib/db.js";
import { inboxCounts, loadInbox, parsePlatform, type InboxKind } from "../../lib/inbox/list.js";
import { loadPromoAccounts } from "../../lib/inbox/promo.js";
import { loadReplyStatus, type ReplyStatusLabel } from "../../lib/inbox/status.js";
import { emptyFor, FILTER_LABEL, filterOptions, inboxHref, kindTabs, parseFilter, replyStatusSentence, resultNotice } from "../../lib/inbox/view.js";
import {
  ButtonLink,
  Card,
  CardLink,
  DataList,
  DataRow,
  Dropdown,
  EmptyState,
  FOCUS,
  InlineNotice,
  PageHeader,
  PLATFORM_NAME,
  PlatformLogo,
  TabLinks,
  cx,
} from "../ui/index.js";
import { InboxItemCard } from "./InboxItemCard.js";

export type InboxSearchParams = Record<string, string | string[] | undefined>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);

const MODE_WORD: Record<ReplyStatusLabel, string> = { off: "Off", "drafts only": "Drafts only", auto: "Auto", "held (killed)": "Paused" };
const PAGE = 20;

/**
 * /inbox and /inbox/dms (v3): title + status line + filter Dropdown, the Comments | DMs segments, then one
 * card per item. Desktop adds a 4-column aside (reply mode per platform; on Ignored, the always-ignore list).
 * The kill switch and mode controls live in Settings. Pages call requireSession() first.
 */
export async function InboxScreen({ kind, sp }: { kind: InboxKind; sp: InboxSearchParams }) {
  const pool = getPool();
  const now = new Date();
  const filter = parseFilter({ filter: param(sp.filter), tab: param(sp.tab) });
  const cursor = param(sp.cursor) ?? null;
  const platform = parsePlatform(param(sp.platform));
  const other: InboxKind = kind === "comments" ? "dms" : "comments";

  const [page, otherCounts, status, promo] = await Promise.all([
    loadInbox(pool, { kind, filter, cursor, limit: PAGE, now, platform }),
    inboxCounts(pool, other),
    loadReplyStatus(pool),
    filter === "ignored" ? loadPromoAccounts(pool) : Promise.resolve(null),
  ]);
  const counts = page.counts;
  const need = { comments: kind === "comments" ? counts["needs-you"] : otherCounts["needs-you"], dms: kind === "dms" ? counts["needs-you"] : otherCounts["needs-you"] };
  const notice = resultNotice({ note: param(sp.note), error: param(sp.error) });
  const empty = emptyFor(kind, filter);
  const noun = kind === "dms" ? "messages" : "comments";

  return (
    <AppFrame active="inbox">
      <PageHeader
        title="Inbox"
        subtitle={
          <>
            {replyStatusSentence(status.lines)}.{" "}
            <Link href="/settings" className={cx("rounded-ds-xs font-semibold text-ds-accent-fg hover:underline", FOCUS)}>
              Settings
            </Link>
          </>
        }
        action={<Dropdown label={`Show ${noun}`} options={filterOptions(kind, counts, filter)} />}
      />

      {platform ? (
        <ButtonLink href={inboxHref(kind, filter)} variant="ghost" size="sm" className="mb-2">
          Showing {PLATFORM_NAME[platform]} only · Show all
        </ButtonLink>
      ) : null}

      <TabLinks ariaLabel="Comments or DMs" items={kindTabs(kind, filter, need.comments, need.dms)} className="lg:max-w-sm" />

      {notice ? (
        <InlineNotice tone={notice.tone} live className="mt-3 lg:mt-4">
          {notice.text}
        </InlineNotice>
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-3 lg:mt-4 lg:grid-cols-12 lg:gap-4">
        <section aria-label={`${FILTER_LABEL[filter]} ${noun}`} className="min-w-0 lg:col-span-8">
          {page.rows.length === 0 ? (
            <Card>
              <EmptyState
                icon="message"
                title={cursor ? "No older items" : empty.title}
                body={cursor ? undefined : empty.body}
                action={
                  <ButtonLink href={cursor ? inboxHref(kind, filter) : empty.action.href} variant="outline" size="sm">
                    {cursor ? "Back to the newest" : empty.action.label}
                  </ButtonLink>
                }
              />
            </Card>
          ) : (
            <>
              <ul className="flex flex-col gap-3 lg:gap-4">
                {page.rows.map((r) => (
                  <InboxItemCard key={`${r.kind}-${r.id}`} row={r} filter={filter} now={now} />
                ))}
              </ul>
              {page.nextCursor ? (
                <div className="mt-3 flex justify-center lg:mt-4">
                  <ButtonLink href={`${inboxHref(kind, filter, page.nextCursor)}${platform ? `&platform=${platform}` : ""}`} variant="outline" size="sm">
                    Show older
                  </ButtonLink>
                </div>
              ) : null}
            </>
          )}
        </section>

        <aside aria-label="Reply settings" className="hidden min-w-0 flex-col gap-4 lg:col-span-4 lg:flex lg:self-start">
          <Card title="Replies" titleId="reply-modes" subtitle="How each platform answers comments" action={<CardLink href="/settings">Settings</CardLink>}>
            <DataList label="Reply mode per platform">
              {status.lines.map((l) => (
                <DataRow
                  key={l.platform}
                  leading={
                    <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-ds-sm bg-ds-raised text-ds-text">
                      <PlatformLogo platform={l.platform} size={18} />
                    </span>
                  }
                  title={PLATFORM_NAME[l.platform]}
                  trailing={<span className={cx("text-[14px]", l.label === "auto" ? "text-ds-accent-fg" : l.label === "held (killed)" ? "text-ds-warn" : "text-ds-muted")}>{MODE_WORD[l.label]}</span>}
                />
              ))}
            </DataList>
            <p className="mt-4 text-[13px] leading-snug text-ds-muted">DMs are never answered by the app. You copy a draft and reply in Instagram.</p>
          </Card>

          {promo ? (
            <Card title="Always ignored" titleId="promo-accounts" subtitle={promo.length === 1 ? "1 account" : `${promo.length} accounts`} action={<CardLink href="/settings">Manage</CardLink>}>
              {promo.length === 0 ? (
                <p className="text-[14px] text-ds-muted">No accounts yet. &ldquo;Always ignore this account&rdquo; adds one.</p>
              ) : (
                <DataList label="Accounts on the always-ignore list">
                  {promo.slice(0, 8).map((a) => (
                    <DataRow
                      key={a.id}
                      leading={<PlatformLogo platform={a.platform} size={16} className="shrink-0 text-ds-text" />}
                      title={a.displayHandle ? `@${a.displayHandle.replace(/^@+/, "")}` : "Unknown account"}
                      trailing={<span className="text-[13px] font-normal text-ds-muted">{a.source === "rule" ? "By a rule" : "By you"}</span>}
                    />
                  ))}
                </DataList>
              )}
            </Card>
          ) : null}
        </aside>
      </div>
    </AppFrame>
  );
}
