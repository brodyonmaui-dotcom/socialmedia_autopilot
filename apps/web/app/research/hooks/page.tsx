import Link from "next/link";
import { blocklistFromEnv, lintText } from "@autopilot/research";
import { getPool } from "../../../lib/db.js";
import { requireSession } from "../../../lib/auth/require.js";
import { loadHooks, loadResearchStatus } from "../../../lib/research/ideas.js";
import { draftFrom, listHref, parsePillar, pillarOptions, whenText } from "../../../lib/research/cards.js";
import { Button, ButtonLink, Card, Dialog, Dropdown, EmptyState, InlineNotice, Input, Select, buttonClasses } from "../../../components/ui/index.js";
import { HookCard } from "../../../components/research/HookCard.js";
import { UsedList } from "../../../components/research/UsedList.js";
import { param, PillarSelect, ResearchFrame, type SearchParams } from "../../../components/research/ResearchFrame.js";
import { addHookFlowAction } from "../flow-actions.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hooks · My Socials" };

/** /research/hooks (v3): opening lines not used yet; fill-in template first, the reference line beneath. */
export default async function HooksPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const pillar = parsePillar(sp.pillar);
  const pool = getPool();
  const now = new Date();
  const [hooks, status] = await Promise.all([loadHooks(pool, { used: false, pillar }), loadResearchStatus(pool, now)]);
  const blocklist = blocklistFromEnv();

  const self = listHref("/research/hooks", { pillar });
  const adding = param(sp.add) === "1";
  const error = param(sp.error);
  const note = param(sp.note);
  const draft = draftFrom("hook", sp);

  return (
    <ResearchFrame
      current="hooks"
      status={status}
      now={now}
      error={error}
      note={note}
      action={
        <Link href={listHref("/research/hooks", { pillar }, { add: "1" })} scroll={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
          Add hook
        </Link>
      }
    >
      <div className="mt-4 flex flex-wrap items-center gap-2 lg:mt-6">
        <Dropdown label="Topic" align="start" options={pillarOptions("/research/hooks", null, pillar)} />
        <p className="ds-helper">Least used first. Fill the brackets with your own words.</p>
      </div>

      <section aria-label="Hooks" className="mt-3 lg:mt-4">
        {hooks.length === 0 ? (
          <Card>
            {pillar ? (
              <EmptyState
                icon="research"
                title="Nothing here"
                body="No unused hooks for this topic."
                action={
                  <ButtonLink href="/research/hooks" variant="outline" size="sm">
                    Show all hooks
                  </ButtonLink>
                }
              />
            ) : (
              <EmptyState
                icon="research"
                title="No hooks right now"
                body={`New ones arrive with the next refresh, ${whenText(status.nextRunAt, now)}.`}
                action={
                  <ButtonLink href="/research/hooks?add=1" variant="outline" size="sm">
                    Add a hook
                  </ButtonLink>
                }
              />
            )}
          </Card>
        ) : (
          <UsedList
            label="Hooks"
            className="lg:grid-cols-2"
            backTo="/research/hooks"
            resetKey={`${self}|${error ?? ""}|${note ?? ""}`}
            items={hooks.map((h) => {
              const warnings = h.source === "own" ? lintText({ text: h.text, kind: "hook", pillar: h.pillar, blocklist }).issues.map((w) => w.message) : [];
              return { id: h.id, node: <HookCard hook={h} back="/research/hooks" warnings={warnings} /> };
            })}
          />
        )}
      </section>

      {adding ? (
        <Dialog open title="Add a hook" closeHref={self}>
          <form key={error ?? "new"} action={addHookFlowAction} className="flex flex-col gap-4">
            <input type="hidden" name="return" value={self} />
            {error ? (
              <InlineNotice tone="danger" live>
                {error}
              </InlineNotice>
            ) : null}
            <Input label="Opening line" name="text" required maxLength={200} placeholder="My lats are not a fan of this…" defaultValue={draft.text} />
            <PillarSelect defaultValue={draft.pillar ?? pillar ?? ""} />
            <Select label="Whose line" name="source" defaultValue={draft.source === "creator" ? "creator" : "own"}>
              <option value="own">Mine</option>
              <option value="creator">A creator&rsquo;s pattern</option>
            </Select>
            <div className="flex justify-end">
              <Button type="submit" variant="solid">
                Add hook
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </ResearchFrame>
  );
}
