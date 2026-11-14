import { AppFrame } from "../../../components/AppFrame.js";
import { ButtonLink, CONTAINER, EmptyState, ListRow, ListRows, Readout, cx } from "../../../components/ui/index.js";
import { getPool } from "../../../lib/db.js";
import { requireSession } from "../../../lib/auth/require.js";
import { counts, listDmThreads, relativeTime } from "../../../lib/engagement/queries.js";
import { loadEngagement } from "../../../lib/engagement/settings.js";
import { handleLabel, lastMessages, plural } from "../../../lib/inbox/view.js";
import { Notice } from "../../batches/ui/Notice.js";
import { copyDraftAction } from "../actions.js";
import { CopyButton, ReplyWell } from "../ui/CommentCard.js";
import { DmCountdown } from "../ui/DmCountdown.js";
import { DmDraftsSwitch } from "../ui/DmDraftsSwitch.js";
import { InboxHero, inboxFooter } from "../ui/InboxFrame.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "DMs · runmysocials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 300) : undefined);
/** Instagram handles only: letters, digits, dot, underscore. Anything else gets no deep link. */
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

export default async function DmsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const pool = getPool();
  const now = new Date();
  const [c, threads, engagement] = await Promise.all([counts(pool, now), listDmThreads(pool, now), loadEngagement(pool)]);
  const dmOn = engagement.dmPollVerified;
  const error = param(sp.error);
  const note = param(sp.note);
  const drafts = threads.filter((t) => t.draft).length;

  return (
    <AppFrame active="inbox" footer={inboxFooter}>
      <InboxHero
        c={c}
        onDms
        pulse={c.dmsOpen > 0 ? { label: `${plural(c.dmsOpen, "window")} open`, tone: "accent" } : { label: "No open windows", tone: "muted" }}
        aside={
          <>
            <p className="ds-caps text-ds-muted">Read + draft only</p>
            <p className="text-[20px] font-bold leading-tight tracking-[-0.02em]">
              You answer every DM <span className="ds-serif font-normal">yourself</span> in the Instagram app.
            </p>
            <p className="ds-note">The app never messages anyone. Copy a draft, open the thread and reply there inside the 24 h window.</p>
            <Readout
              items={[
                { k: "Threads", v: String(threads.length) },
                { k: "Open · 24 h", v: String(c.dmsOpen) },
                { k: "Drafts", v: String(drafts) },
                { k: "Route", v: "Assisted" },
              ]}
            />
          </>
        }
      />
      <Notice error={error} note={note} />

      <section aria-labelledby="dm-drafts" className="border-b border-ds-line">
        <div className={cx(CONTAINER, "grid grid-cols-4 gap-y-3 py-6 lg:grid-cols-12 lg:py-8")}>
          <h2 id="dm-drafts" className="ds-caps col-span-4 text-ds-muted lg:col-span-4 lg:pt-3">
            DM drafts · {dmOn ? "on" : "off"}
          </h2>
          <div className="col-span-4 lg:col-span-8">
            <DmDraftsSwitch key={`${dmOn}|${error ?? ""}|${note ?? ""}`} on={dmOn} />
          </div>
        </div>
      </section>

      <section aria-labelledby="threads" className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
        <div className="col-span-4 min-w-0 py-6 lg:col-span-8 lg:col-start-1 lg:border-r lg:border-ds-line lg:py-10 lg:pr-10">
          <h2 id="threads" className="ds-caps text-ds-muted">
            {plural(threads.length, "thread")}
          </h2>
          {threads.length === 0 ? (
            <EmptyState
              icon="message"
              title="No DM threads yet"
              body={
                dmOn
                  ? "DM drafts are on. Threads show up here after the next read (every 5 minutes)."
                  : "DM drafts are off. Turn them on above to read Instagram DMs and get drafts to copy. Nothing is ever sent."
              }
              className="py-16"
            />
          ) : (
            <ListRows label="DM threads" className="mt-2 border-y border-ds-line">
              {threads.map((t) => (
                <ListRow
                  key={t.id}
                  avatar={{ platform: "instagram" }}
                  title={handleLabel(t.handle, "unknown")}
                  subtitle={t.lastInboundAt ? relativeTime(t.lastInboundAt, now) : undefined}
                >
                  <DmCountdown lastInboundAt={t.lastInboundAt} initialNow={now.toISOString()} />
                  <ol aria-label="Last messages" className="flex flex-col divide-y divide-ds-line border-y border-ds-line">
                    {lastMessages(t.messages).map((m) => (
                      <li key={m.id} className="grid grid-cols-[56px_1fr] gap-3 py-3">
                        <span className={cx("ds-caps pt-1", m.dir === "out" ? "text-ds-accent-fg" : "text-ds-faint")}>{m.who}</span>
                        <span className="text-[16px] leading-normal text-ds-text">{m.text}</span>
                      </li>
                    ))}
                  </ol>
                  {t.draft ? <ReplyWell label={`Draft${t.draft.bucket ? ` · ${t.draft.bucket}` : ""}`} text={t.draft.text} /> : null}
                  <div className="flex flex-wrap gap-2">
                    {t.draft ? <CopyButton text={t.draft.text} label="Copy draft" onCopied={copyDraftAction.bind(null, t.draft.id)} /> : null}
                    {t.handle && HANDLE.test(t.handle) ? (
                      <ButtonLink href={`https://ig.me/m/${t.handle}`} target="_blank" rel="noreferrer" variant="outline" size="sm" className="px-4" arrow>
                        Open Instagram
                      </ButtonLink>
                    ) : null}
                  </div>
                </ListRow>
              ))}
            </ListRows>
          )}
        </div>
      </section>
    </AppFrame>
  );
}
