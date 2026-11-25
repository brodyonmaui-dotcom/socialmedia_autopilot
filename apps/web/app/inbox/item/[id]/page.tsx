// The push-notification landing page (/app/inbox/item/<commentId>): one comment, its drafted reply and one big
// "Approve & send". The button queues the reply for the worker, which applies every gate (dry-run, kill
// switch, limits, thread re-check). Already handled → the state, no button.
import { notFound } from "next/navigation";
import { AppFrame } from "../../../../components/AppFrame.js";
import { ReplyComposer } from "../../../../components/inbox/ReplyComposer.js";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardLink,
  Chip,
  ConfirmSheet,
  DataList,
  DataRow,
  Icon,
  InlineNotice,
  PageHeader,
  PLATFORM_NAME,
  PlatformLogo,
  Thumb,
} from "../../../../components/ui/index.js";
import { requireSession } from "../../../../lib/auth/require.js";
import { getPool } from "../../../../lib/db.js";
import { replyReadiness } from "@autopilot/engagement/src/status.js";
import { loadInboxItem, loadWorkerReplyStatus } from "../../../../lib/inbox/item.js";
import { loadReplyStatus } from "../../../../lib/inbox/status.js";
import { canTestReply, itemPlan, reasonChip, resultNotice, TEST_REPLY_TEXT, testReplyConfirm } from "../../../../lib/inbox/view.js";
import { approveAndSendAction, blockAuthorAction, ignoreAccountAction, markHandledAction, notSpamAction, sendManualAction, testReplyAction } from "../../actions.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comment · My Socials" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);
const MODE_WORD = { off: "Off", "drafts only": "Drafts only", auto: "Auto", "held (killed)": "Paused" } as const;

export default async function InboxItemPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const pool = getPool();
  const [item, status] = await Promise.all([loadInboxItem(pool, id), loadReplyStatus(pool)]);
  if (!item) notFound();
  const worker = await loadWorkerReplyStatus(pool, item.platform);
  const readiness = replyReadiness(item.platform, worker);

  const plan = itemPlan(item);
  const chip = item.state === "ignored" ? null : reasonChip(item.triage?.bucket, item.triage?.reasons.join("; "));
  const platform = PLATFORM_NAME[item.platform];
  const mode = status.lines.find((l) => l.platform === item.platform);
  const composing = plan.primary === "approve" || plan.primary === "write";
  const error = param(sp.error);
  // A refusal for this item's reply shows under the field; everything else at the top.
  const notice = resultNotice({ note: param(sp.note), error: composing ? undefined : error });
  const fieldError = composing && error ? (resultNotice({ error })?.text ?? error) : undefined;

  // Secondary, behind a confirm: the normal approve path with 👍, to prove replies reach the platform.
  const testReply = canTestReply(plan, worker?.canReply) ? (
    <ConfirmSheet
      triggerLabel={`Send a test reply (${TEST_REPLY_TEXT})`}
      triggerVariant="ghost"
      title="Send a test reply?"
      confirmLabel={`Post ${TEST_REPLY_TEXT}`}
      formAction={testReplyAction.bind(null, item.commentId)}
      body={<p>{testReplyConfirm(item.platform, item.authorName)}</p>}
    />
  ) : null;

  const dismiss = plan.canDismiss ? (
    <form action={markHandledAction.bind(null, item.commentId)}>
      <Button type="submit" variant="ghost">
        Dismiss
      </Button>
    </form>
  ) : null;

  return (
    <AppFrame active="inbox">
      <PageHeader title="Comment" back={{ href: "/inbox", label: "Inbox" }} subtitle={`${item.authorName} on ${platform} · ${item.age}`} />

      {notice ? (
        <InlineNotice tone={notice.tone} live className="mb-3 lg:mb-4">
          {notice.text}
        </InlineNotice>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:gap-4">
        <section aria-label={`Comment from ${item.authorName}`} className="flex min-w-0 flex-col gap-4 rounded-ds-lg border border-ds-line bg-ds-card p-4 lg:col-span-8 lg:gap-5 lg:p-5">
          {item.postTitle ? (
            <div className="flex items-center gap-3 border-b border-ds-line pb-4">
              <Thumb mediaId={item.mediaId} alt={`${item.postTitle} poster`} className="w-9" />
              <div className="min-w-0 flex-1">
                <p className="ds-label text-ds-muted">On your post</p>
                <p className="ds-font-display overflow-hidden text-ellipsis whitespace-nowrap text-[20px] text-ds-text">{item.postTitle}</p>
              </div>
              {item.postUrl ? (
                <a href={item.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-ds-sm px-2 text-[14px] font-semibold text-ds-accent-fg hover:bg-ds-raised lg:min-h-9">
                  View
                  <Icon name="arrowUpRight" size={16} />
                </a>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-start gap-3">
            <Avatar name={item.authorName} className="size-11 text-[16px]" />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="overflow-hidden text-ellipsis whitespace-nowrap text-[16px] font-semibold text-ds-text">{item.authorName}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ds-muted">
                <PlatformLogo platform={item.platform} size={13} className="shrink-0 text-ds-text" />
                {platform} · {item.age}
              </p>
            </div>
            {plan.status ? <Badge tone={plan.status.tone}>{plan.status.label}</Badge> : chip ? <Chip tone={chip.tone}>{chip.label}</Chip> : null}
          </div>

          <p className="whitespace-pre-wrap break-words text-[19px] leading-snug text-ds-text lg:text-[20px]">{item.text}</p>

          {plan.rule ? (
            <p className="flex items-start gap-1.5 text-[14px] leading-snug text-ds-muted">
              <Icon name="alert" size={16} className="mt-px shrink-0 text-ds-warn" />
              {plan.rule}
            </p>
          ) : null}
          {plan.note ? <p className="text-[14px] leading-snug text-ds-muted">{plan.note}</p> : null}
          {plan.link ? (
            <a href={plan.link.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 self-start rounded-ds-sm px-2 text-[14px] font-semibold text-ds-accent-fg hover:bg-ds-raised lg:min-h-9">
              {plan.link.label}
              <Icon name="arrowUpRight" size={16} />
            </a>
          ) : null}

          {composing ? (
            <ReplyComposer
              action={approveAndSendAction.bind(null, item.commentId)}
              mode={plan.primary as "approve" | "write"}
              draft={item.draftedReply}
              error={fieldError}
              size="lg"
              extra={
                <>
                  {testReply}
                  {dismiss}
                </>
              }
            />
          ) : (
            <>
              {item.reply?.text && item.state !== "drafted" ? (
                <div className="rounded-ds-sm bg-ds-raised px-3 py-2.5">
                  <p className="ds-label text-ds-muted">Your reply</p>
                  <p className="mt-1 whitespace-pre-wrap text-[17px] leading-snug text-ds-text">{item.reply.text}</p>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 empty:hidden">
                {plan.canHide ? (
                  <form action={sendManualAction.bind(null, item.commentId, "hide")}>
                    <Button type="submit" variant="outline" tone="danger" size="sm">
                      Hide on Instagram
                    </Button>
                  </form>
                ) : null}
                {plan.canNotSpam ? (
                  <form action={notSpamAction.bind(null, "comment", item.commentId)}>
                    <Button type="submit" variant="outline" size="sm">
                      Not spam
                    </Button>
                  </form>
                ) : null}
                {dismiss}
              </div>
            </>
          )}
        </section>

        <Card title="Details" titleId="details" className="lg:col-span-4 lg:self-start" action={<CardLink href="/settings">Settings</CardLink>}>
          <DataList label="About this comment">
            <DataRow icon="message" title="Why it's here" meta={item.state === "ignored" ? "Promo spam: never replied to" : (chip?.label ?? "Sorted by the reply rules")} />
            <DataRow icon="reply" title={`Replies on ${platform}`} meta={mode ? MODE_WORD[mode.label] : "Off"} />
            <DataRow icon="reply" title="Delivery" meta={readiness.text} />
            <DataRow icon="clock" title="Received" meta={item.age} />
          </DataList>
          {plan.canIgnoreAccount || (item.authorId && !item.isOwn) ? (
            <div className="mt-4 flex flex-col items-start gap-1 border-t border-ds-line pt-3">
              {plan.canIgnoreAccount ? (
                <form action={ignoreAccountAction.bind(null, "comment", item.commentId)}>
                  <Button type="submit" variant="ghost" size="sm" className="-ml-3">
                    Always ignore this account
                  </Button>
                </form>
              ) : null}
              {item.authorId && !item.isOwn ? (
                <form action={blockAuthorAction.bind(null, item.platform, item.authorId)}>
                  <Button type="submit" variant="ghost" size="sm" className="-ml-3">
                    Never auto-reply to this person
                  </Button>
                </form>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>
    </AppFrame>
  );
}
