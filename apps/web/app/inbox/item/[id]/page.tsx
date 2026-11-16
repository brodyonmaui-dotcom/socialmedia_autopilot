// Run 4: one inbox item, the push deep link (/app/inbox/item/<commentId>). Minimal and functional; the
// designer builds the real page from lib/inbox/item.ts. The approve button queues the drafted reply for
// the worker, which applies every gate (dry-run, kill switch, limits, thread re-check).
import { notFound } from "next/navigation";
import { AppFrame } from "../../../../components/AppFrame.js";
import { Button, ButtonLink, CONTAINER, Input, cx } from "../../../../components/ui/index.js";
import { requireSession } from "../../../../lib/auth/require.js";
import { getPool } from "../../../../lib/db.js";
import { loadInboxItem } from "../../../../lib/inbox/item.js";
import { bucketChip, PLATFORM_NAME } from "../../../../lib/inbox/view.js";
import { Notice } from "../../../batches/ui/Notice.js";
import { approveAndSendAction, ignoreAccountAction, markHandledAction, notSpamAction } from "../../actions.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comment · runmysocials" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);

export default async function InboxItemPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const item = await loadInboxItem(getPool(), id);
  if (!item) notFound();
  const chip = item.triage ? bucketChip(item.triage.bucket) : null;
  const canApprove = item.state === "drafted" || (item.state === "needs-you" && item.triage?.bucket === "flag");

  return (
    <AppFrame active="inbox">
      <Notice error={param(sp.error)} note={param(sp.note)} />
      <div className={cx(CONTAINER, "flex flex-col gap-6 py-8")}>
        <ButtonLink href="/inbox" variant="ghost" size="sm" className="self-start">
          Back to inbox
        </ButtonLink>

        <section aria-labelledby="comment" className="flex flex-col gap-2">
          <p className="ds-caps text-ds-muted">
            {PLATFORM_NAME[item.platform]} · {item.age}
            {item.postTitle ? ` · ${item.postTitle}` : ""}
          </p>
          <h1 id="comment" className="text-lg font-semibold">
            {item.authorName}
          </h1>
          <p className="whitespace-pre-wrap">{item.text}</p>
          {chip ? (
            <p className="ds-note">
              {chip.label}
              {item.triage?.reasons.length ? ` · ${item.triage.reasons.join("; ")}` : ""}
            </p>
          ) : (
            <p className="ds-note">Not triaged yet.</p>
          )}
        </section>

        {item.reply && item.state !== "drafted" ? (
          <section aria-labelledby="reply" className="flex flex-col gap-1">
            <h2 id="reply" className="ds-caps text-ds-muted">
              Reply · {item.state}
            </h2>
            <p>{item.reply.text}</p>
            {item.reply.lastError ? <p className="ds-note">{item.reply.lastError}</p> : null}
          </section>
        ) : null}

        {canApprove ? (
          <form action={approveAndSendAction.bind(null, item.commentId)} className="flex flex-col gap-3">
            <Input
              label={item.draftedReply ? "Drafted reply (edit if you like)" : "Your reply"}
              name="text"
              defaultValue={item.draftedReply ?? ""}
              maxLength={300}
              autoComplete="off"
            />
            <Button type="submit" variant="solid" block>
              Approve & send
            </Button>
            <p className="ds-note">One tap queues it for the worker. Kill switch, limits and dry-run still apply.</p>
          </form>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {item.state === "ignored" ? (
            <form action={notSpamAction.bind(null, "comment", item.commentId)}>
              <Button type="submit" variant="outline" size="sm">
                Not spam
              </Button>
            </form>
          ) : null}
          {item.state === "needs-you" || item.state === "drafted" ? (
            <>
              <form action={markHandledAction.bind(null, item.commentId)}>
                <Button type="submit" variant="outline" size="sm">
                  Done
                </Button>
              </form>
              <form action={ignoreAccountAction.bind(null, "comment", item.commentId)}>
                <Button type="submit" variant="ghost" size="sm">
                  Always ignore this account
                </Button>
              </form>
            </>
          ) : null}
        </div>
      </div>
    </AppFrame>
  );
}
