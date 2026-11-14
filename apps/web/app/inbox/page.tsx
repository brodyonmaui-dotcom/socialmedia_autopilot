import { AppFrame } from "../../components/AppFrame.js";
import { CONTAINER, EmptyState, ListRows, Readout, TabLinks, cx } from "../../components/ui/index.js";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { counts, listInbox, relativeTime } from "../../lib/engagement/queries.js";
import { loadEngagement } from "../../lib/engagement/settings.js";
import { commentTabs, emptyCopy, enginePulse, ENGAGEMENT_PLATFORMS, limitReadout, plural, sentLast24h, type CommentTab } from "../../lib/inbox/view.js";
import { Notice } from "../batches/ui/Notice.js";
import { CommentCard } from "./ui/CommentCard.js";
import { InboxHero, inboxFooter } from "./ui/InboxFrame.js";
import { KillSwitch } from "./ui/KillSwitch.js";
import { ModeRow } from "./ui/ModeRow.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox · runmysocials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const raw = param(sp.tab);
  const tab: CommentTab = raw === "shadow" || raw === "sent" ? raw : "flagged";
  const pool = getPool();
  const now = new Date();
  // The Sent list doubles as the source for the 24 h limit readout (same query; no new SQL).
  const [settings, c, rows, sentRows] = await Promise.all([
    loadEngagement(pool),
    counts(pool, now),
    listInbox(pool, tab),
    tab === "sent" ? Promise.resolve(null) : listInbox(pool, "sent"),
  ]);
  const used = sentLast24h(sentRows ?? rows, now);
  const empty = emptyCopy(tab);

  return (
    <AppFrame active="inbox" footer={inboxFooter}>
      <InboxHero
        c={c}
        onDms={false}
        pulse={enginePulse(settings)}
        aside={
          <>
            <p className="ds-caps text-ds-muted">Auto-replies</p>
            <KillSwitch killed={settings.killed} reason={settings.killedReason} tab={tab} />
            <p className="ds-note">
              Shadow stores what the worker would say; live replies go out after a {settings.minDelayMin}-minute veto window. Kill first if a reply looks wrong.
            </p>
          </>
        }
      />
      <Notice error={param(sp.error)} note={param(sp.note)} />

      <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
        <section aria-labelledby="comments" className="col-span-4 min-w-0 border-b border-ds-line py-6 lg:col-span-8 lg:border-b-0 lg:border-r lg:py-10 lg:pr-10">
          <h2 id="comments" className="sr-only">
            Comments
          </h2>
          <TabLinks ariaLabel="Comment lists" items={commentTabs(tab, c)} />
          {rows.length === 0 ? (
            <EmptyState icon="message" title={empty.title} body={empty.body} className="py-16" />
          ) : (
            <>
              <p className="ds-caps mt-6 text-ds-muted">{plural(rows.length, "comment")}</p>
              <ListRows label={`${tab} comments`} className="mt-2 border-y border-ds-line">
                {rows.map((r) => (
                  <CommentCard key={`${r.commentId}-${r.actionId ?? ""}`} row={r} tab={tab} when={relativeTime(r.commentedAt, now)} />
                ))}
              </ListRows>
            </>
          )}
        </section>

        <aside aria-label="Modes and limits" className="col-span-4 flex min-w-0 flex-col gap-10 py-8 lg:py-10 lg:pl-10">
          <div>
            <p className="ds-caps text-ds-muted">Mode per platform</p>
            <ListRows label="Auto-reply modes" className="mt-2 border-b border-ds-line">
              {ENGAGEMENT_PLATFORMS.map((p) => (
                <ModeRow key={p} platform={p} mode={settings.mode[p]} killed={settings.killed} tab={tab} />
              ))}
            </ListRows>
          </div>
          <div>
            <p className="ds-caps text-ds-muted">Limits · used / left</p>
            <Readout className="mt-4" items={limitReadout(settings.limits, used, settings.minDelayMin)} />
            <p className="ds-note mt-4">Checked again by the worker right before every reply. Manual replies count too.</p>
          </div>
        </aside>
      </div>
    </AppFrame>
  );
}
