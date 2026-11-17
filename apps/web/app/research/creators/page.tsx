import Link from "next/link";
import { getPool } from "../../../lib/db.js";
import { requireSession } from "../../../lib/auth/require.js";
import { loadCreators, loadResearchStatus } from "../../../lib/research/ideas.js";
import { creatorMeta, plural, RUN_WORD, whenText } from "../../../lib/research/cards.js";
import { creatorPlatform } from "../../../lib/research/view.js";
import {
  Button,
  Card,
  CardLink,
  Chip,
  DataList,
  DataRow,
  Dialog,
  EmptyState,
  Input,
  PLATFORM_NAME,
  PlatformLogo,
  Select,
  buttonClasses,
} from "../../../components/ui/index.js";
import { param, PillarSelect, ResearchFrame, type SearchParams } from "../../../components/research/ResearchFrame.js";
import { addCreatorFlowAction, removeCreatorFlowAction } from "../flow-actions.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Creators · My Socials" };

const PLATFORMS = ["instagram", "tiktok", "youtube", "snapchat"] as const;

/** /research/creators (v3): who research follows (add / remove only), and when ideas were last refreshed. */
export default async function CreatorsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const pool = getPool();
  const now = new Date();
  const [creators, status] = await Promise.all([loadCreators(pool), loadResearchStatus(pool, now)]);
  const active = creators.filter((c) => c.active);
  const removed = creators.length - active.length;
  const removing = active.find((c) => c.id === param(sp.remove));
  const run = status.lastRun;
  const runWhen = run ? whenText(run.finishedAt ?? run.startedAt, now) : null;
  const ai = status.aiNotes;

  return (
    <ResearchFrame current="creators" status={status} now={now} error={param(sp.error)} note={param(sp.note)}>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:mt-6 lg:grid-cols-12 lg:gap-4">
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-8 lg:gap-4">
          <Card title="Following" titleId="following" subtitle={active.length ? `${plural(active.length, "creator")}. Their public posts become ideas.` : undefined}>
            {active.length === 0 ? (
              <EmptyState
                icon="users"
                title="No one yet"
                body="Add a creator whose hooks you like. Ideas from their posts show up after the next refresh."
                action={
                  <a href="#add-creator" className={buttonClasses({ variant: "outline", size: "sm" })}>
                    Add a creator
                  </a>
                }
              />
            ) : (
              <DataList label="Creators you follow">
                {active.map((c) => {
                  const platform = creatorPlatform(c.platform);
                  return (
                    <DataRow
                      key={c.id}
                      leading={
                        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-ds-sm bg-ds-raised text-ds-text">
                          <PlatformLogo platform={platform} size={18} title={PLATFORM_NAME[platform]} />
                        </span>
                      }
                      title={`@${c.handle}`}
                      meta={creatorMeta(c) || PLATFORM_NAME[platform]}
                      trailing={
                        <Link href={`/research/creators?remove=${encodeURIComponent(c.id)}`} scroll={false} aria-label={`Remove @${c.handle}`} className={buttonClasses({ variant: "ghost", size: "sm" })}>
                          Remove
                        </Link>
                      }
                    />
                  );
                })}
              </DataList>
            )}
            {removed > 0 ? (
              <p className="ds-helper mt-4">
                {removed === 1 ? "1 removed creator is" : `${removed} removed creators are`} kept for history. Add the handle again to follow them again.
              </p>
            ) : null}
          </Card>

          <section id="add-creator" aria-labelledby="add-title" className="scroll-mt-20 rounded-ds-lg border border-ds-line bg-ds-card p-4 lg:p-5">
            <h2 id="add-title" className="ds-heading text-ds-text">
              Add a creator
            </h2>
            <p className="ds-helper mt-1">Public handles only. New ideas from them arrive with the next refresh.</p>
            <form action={addCreatorFlowAction} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Handle" name="handle" required placeholder="@handle or profile link" autoCapitalize="none" autoCorrect="off" className="sm:col-span-2" />
              <Select label="Platform" name="platform" defaultValue="instagram">
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_NAME[p]}
                  </option>
                ))}
              </Select>
              <PillarSelect />
              <div className="sm:col-span-2">
                <Button type="submit" variant="solid">
                  Follow
                </Button>
              </div>
            </form>
          </section>
        </div>

        <aside aria-label="Research refresh" className="min-w-0 lg:col-span-4 lg:self-start">
          <Card title="Refresh" titleId="refresh" subtitle="Research runs by itself every 3 days.">
            <DataList label="Refresh status">
              <DataRow
                icon="clock"
                title="Last refresh"
                meta={run ? `${RUN_WORD[run.status] ?? run.status}${run.creatorsChecked ? ` · ${plural(run.creatorsChecked, "creator")} checked` : ""}` : "Not run yet"}
                trailing={runWhen ? <span className="text-[14px] font-normal text-ds-muted">{runWhen}</span> : undefined}
              />
              <DataRow icon="calendar" title="Next refresh" trailing={<span className="text-[14px] font-normal text-ds-muted">{whenText(status.nextRunAt, now)}</span>} />
              <DataRow
                icon="research"
                title="Added last time"
                meta={run ? `${plural(run.hooksAdded, "hook")} too` : undefined}
                trailing={<span className="ds-num">{run ? plural(run.ideasAdded, "idea") : "–"}</span>}
              />
              <DataRow
                icon="sliders"
                title="AI notes"
                meta={ai.on ? `${ai.tokensUsedThisMonth.toLocaleString("en-US")} of ${ai.monthlyBudgetTokens.toLocaleString("en-US")} tokens this month` : "Turning it on needs your OK in chat"}
                trailing={<CardLink href="/settings">{ai.on ? "On" : "Off"}</CardLink>}
              />
            </DataList>
            {run && run.status !== "ok" && run.status !== "running" ? (
              <div className="mt-4">
                <Chip tone="warn" wrap>
                  {run.note.split("\n")[0] || "Some creators could not be checked."}
                </Chip>
              </div>
            ) : null}
          </Card>
        </aside>
      </div>

      {removing ? (
        <Dialog open title={`Remove @${removing.handle}?`} closeHref="/research/creators">
          <p className="ds-note">Research stops checking their posts. Ideas you already have from them stay. Add the handle again any time to follow them again.</p>
          <form action={removeCreatorFlowAction} className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <input type="hidden" name="id" value={removing.id} />
            <input type="hidden" name="handle" value={removing.handle} />
            <Link href="/research/creators" scroll={false} className={buttonClasses({ variant: "ghost", size: "md" })}>
              Keep following
            </Link>
            <Button type="submit" variant="solid">
              Remove
            </Button>
          </form>
        </Dialog>
      ) : null}
    </ResearchFrame>
  );
}
