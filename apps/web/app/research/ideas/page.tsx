import { allowedMoves, listIdeas, IDEA_STAGES, type Idea, type IdeaStage } from "@autopilot/research";
import { getPool } from "../../../lib/db.js";
import { addIdeaAction, moveIdeaAction } from "../actions.js";
import { button, ErrorBanner, errorFrom, input, PillarSelect, ResearchHeader, smallButton, type SearchParams } from "../ui.js";
import { requireSession } from "../../../lib/auth/require.js";

export const dynamic = "force-dynamic";

/** The field a move needs (see moveIdea in packages/research): shown inline next to that move's button. */
const NEEDS: Partial<Record<IdeaStage, { name: string; placeholder: string }>> = {
  scripted: { name: "script", placeholder: "shots / talking points" },
  filmed: { name: "mediaId", placeholder: "library clip id" },
  posted: { name: "batchItemIds", placeholder: "batch item id(s)" },
};

function MoveForm({ idea, to }: { idea: Idea; to: IdeaStage }) {
  const need = NEEDS[to];
  return (
    <form action={moveIdeaAction} className="flex gap-2">
      <input type="hidden" name="id" value={idea.id} />
      <input type="hidden" name="to" value={to} />
      {need &&
        (need.name === "script" ? (
          <textarea name="script" defaultValue={idea.script} placeholder={need.placeholder} rows={2} className={input} />
        ) : (
          <input name={need.name} placeholder={need.placeholder} className={input} />
        ))}
      <button className={smallButton}>→ {to}</button>
    </form>
  );
}

export default async function IdeasPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const error = await errorFrom(searchParams);
  const ideas = await listIdeas(getPool());

  return (
    <main className="mx-auto max-w-md p-4">
      <ResearchHeader title="Idea backlog" current="/research/ideas" />
      <ErrorBanner error={error} />

      <form action={addIdeaAction} className="mt-4 space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <input name="title" required maxLength={140} placeholder="Idea (e.g. pull day form check)" className={input} />
        <input name="hook" maxLength={200} placeholder="Hook / first line (optional)" className={input} />
        <div className="flex gap-2">
          <PillarSelect />
          <button className={button}>Add</button>
        </div>
      </form>

      {IDEA_STAGES.map((stage) => {
        const inStage = ideas.filter((i) => i.stage === stage);
        if (!inStage.length) return null;
        return (
          <section key={stage} className="mt-6">
            <h2 className="text-sm font-semibold">
              {stage} ({inStage.length})
            </h2>
            <ul className="mt-2 divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
              {inStage.map((idea) => (
                <li key={idea.id} className="space-y-2 p-3">
                  <div>
                    <div className="font-medium">{idea.title}</div>
                    <div className="text-neutral-500">
                      {idea.pillar ?? "—"}
                      {idea.hook ? ` · "${idea.hook}"` : ""}
                    </div>
                    {idea.script && <p className="mt-1 whitespace-pre-line text-neutral-600 dark:text-neutral-400">{idea.script}</p>}
                  </div>
                  {allowedMoves(idea.stage).map((to) => (
                    <MoveForm key={to} idea={idea} to={to} />
                  ))}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
