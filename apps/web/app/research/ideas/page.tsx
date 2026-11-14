import { allowedMoves, listIdeas, IDEA_STAGES, type Idea, type IdeaStage } from "@autopilot/research";
import { getPool } from "../../../lib/db.js";
import { requireSession } from "../../../lib/auth/require.js";
import { addIdeaAction, moveIdeaAction } from "../actions.js";
import { Badge, Button, CONTAINER, EmptyState, FIELD, FOCUS, Input, ListRow, ListRows, RevealList, SectionHead, cx, type RevealItem } from "../../../components/ui/index.js";
import { ideaMeta, plural, stageBadge, two } from "../../../lib/research/view.js";
import { errorFrom, FormBand, PillarSelect, ResearchFrame, type SearchParams } from "../ui.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ideas · runmysocials" };

/** The field a move needs (see moveIdea in packages/research): shown inline next to that move's button. */
const NEEDS: Partial<Record<IdeaStage, { name: string; label: string; placeholder: string }>> = {
  scripted: { name: "script", label: "Script", placeholder: "shots / talking points" },
  filmed: { name: "mediaId", label: "Clip id", placeholder: "library clip id" },
  posted: { name: "batchItemIds", label: "Batch item ids", placeholder: "batch item id(s)" },
};

function MoveForm({ idea, to }: { idea: Idea; to: IdeaStage }) {
  const need = NEEDS[to];
  const fieldId = `move-${idea.id}-${to}`;
  return (
    <form action={moveIdeaAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="id" value={idea.id} />
      <input type="hidden" name="to" value={to} />
      {need &&
        (need.name === "script" ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor={fieldId} className="ds-caps text-ds-muted">
              {need.label}
            </label>
            <textarea id={fieldId} name="script" defaultValue={idea.script} placeholder={need.placeholder} rows={3} className={cx(FIELD, FOCUS, "min-h-24 py-3 leading-normal")} />
          </div>
        ) : (
          <Input id={fieldId} label={need.label} name={need.name} placeholder={need.placeholder} className="min-w-0 flex-1" />
        ))}
      <Button type="submit" variant="outline" size="sm">
        Move to {to}
      </Button>
    </form>
  );
}

export default async function IdeasPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const error = await errorFrom(searchParams);
  const ideas = await listIdeas(getPool());

  let n = 0;
  const stages = IDEA_STAGES.map((stage) => {
    const inStage = ideas.filter((i) => i.stage === stage);
    const s = stageBadge(stage);
    const items: RevealItem[] = inStage.map((i) => ({
      id: i.id,
      index: two(++n),
      title: i.title,
      meta: ideaMeta(i),
      trailing: <Badge tone={s.tone}>{s.label}</Badge>,
    }));
    return { stage, items };
  }).filter((s) => s.items.length > 0);
  const movable = ideas.filter((i) => allowedMoves(i.stage).length > 0);

  return (
    <ResearchFrame current="ideas" error={error}>
      <FormBand title="Add an idea" action={addIdeaAction}>
        <Input label="Idea" name="title" required maxLength={140} placeholder="e.g. pull day form check" className="sm:col-span-2" />
        <Input label="Hook (optional)" name="hook" maxLength={200} placeholder="First line" className="sm:col-span-2" />
        <PillarSelect />
        <div className="flex items-end">
          <Button type="submit" variant="solid" arrow>
            Add idea
          </Button>
        </div>
      </FormBand>

      {ideas.length === 0 ? (
        <div className={cx(CONTAINER, "py-10")}>
          <EmptyState icon="research" title="No ideas yet" body="Add the first one above." className="border border-ds-line" />
        </div>
      ) : (
        stages.map(({ stage, items }, k) => (
          <section key={stage} aria-label={stage}>
            <SectionHead index={two(k + 1)} title={stage[0]!.toUpperCase() + stage.slice(1)} meta={plural(items.length, "idea")} />
            <div className={cx(CONTAINER, "-mt-px pb-10")}>
              <RevealList label={`${stage} ideas`} items={items} />
            </div>
          </section>
        ))
      )}

      {movable.length > 0 ? (
        <section aria-label="Move ideas">
          <SectionHead index={two(stages.length + 1)} title="Move" serif="forward" meta={plural(movable.length, "idea")} />
          <div className={cx(CONTAINER, "-mt-px pb-10")}>
            <ListRows label="Ideas that can move" className="border-t border-ds-line">
              {movable.map((idea) => (
                <ListRow key={idea.id} title={idea.title} subtitle={`${idea.stage} · ${idea.pillar ?? "no pillar"}`}>
                  {idea.script ? <p className="whitespace-pre-line text-[15px] leading-snug text-ds-muted">{idea.script}</p> : null}
                  {allowedMoves(idea.stage).map((to) => (
                    <MoveForm key={to} idea={idea} to={to} />
                  ))}
                </ListRow>
              ))}
            </ListRows>
          </div>
        </section>
      ) : null}
    </ResearchFrame>
  );
}
