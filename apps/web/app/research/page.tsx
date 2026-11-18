import Link from "next/link";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { loadIdeas, loadResearchStatus } from "../../lib/research/ideas.js";
import { draftFrom, forwardMove, ideaHeading, listHref, moveField, parsePillar, parseSource, pillarOptions, sourceChips, whenText } from "../../lib/research/cards.js";
import { Button, ButtonLink, Card, ChipLink, CopyButton, Dialog, Dropdown, EmptyState, InlineNotice, Input, Textarea, buttonClasses } from "../../components/ui/index.js";
import { IdeaCard } from "../../components/research/IdeaCard.js";
import { UsedList } from "../../components/research/UsedList.js";
import { param, PillarSelect, ResearchFrame, type SearchParams } from "../../components/research/ResearchFrame.js";
import { addIdeaFlowAction, moveIdeaFlowAction } from "./flow-actions.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Research · My Socials" };

/** /research = the Ideas tab (v3): source chips + topic Dropdown, idea cards (two columns on desktop), URL dialogs. */
export default async function IdeasPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const source = parseSource(sp.source);
  const pillar = parsePillar(sp.pillar);
  const pool = getPool();
  const now = new Date();
  const [ideas, status] = await Promise.all([loadIdeas(pool, { tab: "ideas", source, pillar }), loadResearchStatus(pool, now)]);

  const self = listHref("/research", { source, pillar });
  const hrefWith = (extra: Record<string, string>) => listHref("/research", { source, pillar }, extra);
  const scriptIdea = ideas.find((i) => i.id === param(sp.script) && i.script.trim());
  const moveIdea = ideas.find((i) => i.id === param(sp.move));
  const moveTo = moveIdea ? forwardMove(moveIdea.stage) : null;
  const field = moveTo ? moveField(moveTo) : null;
  const adding = param(sp.add) === "1";
  const filtered = source !== null || pillar !== null;
  const chips = sourceChips(source, pillar, status.counts.bySource);
  const error = param(sp.error);
  const note = param(sp.note);
  const draft = draftFrom("idea", sp);

  return (
    <ResearchFrame
      current="ideas"
      status={status}
      now={now}
      error={error}
      note={note}
      action={
        <Link href={hrefWith({ add: "1" })} scroll={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
          Add idea
        </Link>
      }
    >
      <div className="mt-4 flex flex-wrap items-center gap-2 lg:mt-6">
        <div className="lg:hidden">
          <Dropdown label="Source" align="start" options={chips.map((c) => ({ label: c.label === "All" ? "All sources" : c.label, href: c.href, current: c.current }))} />
        </div>
        <nav aria-label="Where ideas come from" className="hidden flex-wrap gap-2 lg:flex">
          {chips.map((c) => (
            <ChipLink key={c.label} href={c.href} current={c.current} count={c.count}>
              {c.label}
            </ChipLink>
          ))}
        </nav>
        <Dropdown label="Topic" align="start" options={pillarOptions("/research", source, pillar)} />
      </div>

      <section aria-label="Ideas" className="mt-3 lg:mt-4">
        {ideas.length === 0 ? (
          <Card>
            {filtered ? (
              <EmptyState
                icon="research"
                title="Nothing here"
                body="No open ideas match these filters."
                action={
                  <ButtonLink href="/research" variant="outline" size="sm">
                    Show all ideas
                  </ButtonLink>
                }
              />
            ) : (
              <EmptyState
                icon="research"
                title="No ideas right now"
                body={`New ones arrive with the next refresh, ${whenText(status.nextRunAt, now)}. Following more creators brings more.`}
                action={
                  <ButtonLink href="/research/creators" variant="outline" size="sm">
                    Add a creator
                  </ButtonLink>
                }
              />
            )}
          </Card>
        ) : (
          <UsedList
            label="Ideas"
            className="lg:grid-cols-2"
            backTo="/research"
            resetKey={`${self}|${error ?? ""}|${note ?? ""}`}
            items={ideas.map((idea) => ({ id: idea.id, node: <IdeaCard idea={idea} back="/research" hrefWith={hrefWith} /> }))}
          />
        )}
      </section>

      {scriptIdea ? (
        <Dialog open title={ideaHeading(scriptIdea).title} closeHref={self} size="lg" footer={<CopyButton text={scriptIdea.script} label="Copy the script" variant="solid" size="md" />}>
          {scriptIdea.about.trim() ? <p className="ds-helper mb-4 max-w-[68ch]">{scriptIdea.about}</p> : null}
          <p className="max-w-[68ch] whitespace-pre-wrap text-[16px] leading-relaxed text-ds-text">{scriptIdea.script}</p>
        </Dialog>
      ) : null}

      {moveIdea && moveTo ? (
        <Dialog open title={`Move to ${moveTo}`} closeHref={self}>
          <p className="ds-note mb-4">{ideaHeading(moveIdea).title}</p>
          <form action={moveIdeaFlowAction} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={moveIdea.id} />
            <input type="hidden" name="to" value={moveTo} />
            <input type="hidden" name="return" value={self} />
            {field ? (
              field.multiline ? (
                <Textarea label={field.label} name={field.name} helper={field.helper} rows={6} defaultValue={moveIdea.script} required />
              ) : (
                <Input label={field.label} name={field.name} helper={field.helper} required autoCapitalize="none" />
              )
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" variant="solid">
                Move to {moveTo}
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {adding ? (
        <Dialog open title="Add an idea" closeHref={self}>
          <form key={error ?? "new"} action={addIdeaFlowAction} className="flex flex-col gap-4">
            <input type="hidden" name="return" value={self} />
            {error ? (
              <InlineNotice tone="danger" live>
                {error}
              </InlineNotice>
            ) : null}
            <Input label="Idea" name="title" required maxLength={140} placeholder="e.g. pull day, slow negatives only" defaultValue={draft.title} />
            <Input label="Opening line (optional)" name="hook" maxLength={200} placeholder="The first thing you say" defaultValue={draft.hook} />
            <PillarSelect defaultValue={draft.pillar ?? pillar ?? ""} />
            <div className="flex justify-end">
              <Button type="submit" variant="solid">
                Add idea
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </ResearchFrame>
  );
}
