import { getPool } from "../../../lib/db.js";
import { requireSession } from "../../../lib/auth/require.js";
import {
  loadHooks,
  loadIdeas,
  loadResearchStatus,
} from "../../../lib/research/ideas.js";
import {
  hookView,
  ideaHeading,
  mergeUsed,
  pillarTag,
  whenText,
} from "../../../lib/research/cards.js";
import { ButtonLink, Card, EmptyState } from "../../../components/ui/index.js";
import { UsedList, UsedToggle } from "../../../components/research/UsedList.js";
import {
  param,
  ResearchFrame,
  type SearchParams,
} from "../../../components/research/ResearchFrame.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Already used · My Socials" };

/** /research/used (v3): ideas and hooks he ticked, newest first. Unticking (Undo) sends one back. */
export default async function UsedPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireSession();
  const sp = await searchParams;
  const pool = getPool();
  const now = new Date();
  const [ideas, hooks, status] = await Promise.all([
    loadIdeas(pool, { tab: "used" }),
    loadHooks(pool, { used: true }),
    loadResearchStatus(pool, now),
  ]);
  const entries = mergeUsed(ideas, hooks);
  const error = param(sp.error);
  const note = param(sp.note);

  return (
    <ResearchFrame
      current="used"
      status={status}
      now={now}
      error={error}
      note={note}
    >
      <section aria-label="Already used" className="mt-4 lg:mt-6">
        {entries.length === 0 ? (
          <Card>
            <EmptyState
              icon="check"
              title="Nothing used yet"
              body="Tick Used on an idea or hook once you've filmed it. It moves here, out of the way."
              action={
                <ButtonLink href="/research" variant="outline" size="sm">
                  Open ideas
                </ButtonLink>
              }
            />
          </Card>
        ) : (
          <>
            <p className="ds-helper mb-3">
              Newest first. Untick one to put it back in Ideas or Hooks.
            </p>
            <UsedList
              label="Already used"
              className="lg:max-w-[840px]"
              backTo="/research/used"
              resetKey={`${error ?? ""}|${note ?? ""}`}
              items={entries.map((e) => {
                const isIdea = e.kind === "idea";
                const id = isIdea ? e.idea.id : e.hook.id;
                const head = isIdea ? ideaHeading(e.idea) : null;
                const title =
                  e.kind === "idea"
                    ? head!.quoted
                      ? `“${head!.title}”`
                      : head!.title
                    : hookView(e.hook).main;
                const tag = pillarTag(isIdea ? e.idea.pillar : e.hook.pillar);
                return {
                  id,
                  node: (
                    <article
                      aria-labelledby={`used-${id}`}
                      className="flex w-full min-w-0 items-center gap-3 rounded-ds-lg border border-ds-line bg-ds-card px-4 py-3 lg:px-5"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="ds-label text-ds-muted">
                          {isIdea ? "Idea" : "Hook"} · used{" "}
                          {whenText(e.at, now)}
                        </p>
                        <h3
                          id={`used-${id}`}
                          className="ds-font-display text-[20px] leading-tight text-ds-text [overflow-wrap:anywhere] lg:text-[22px]"
                        >
                          {title}
                        </h3>
                        {tag ? (
                          <span className="ds-tag text-ds-muted">{tag}</span>
                        ) : null}
                      </div>
                      <UsedToggle
                        kind={e.kind}
                        id={id}
                        used
                        title={head?.title ?? title}
                        back="/research/used"
                      />
                    </article>
                  ),
                };
              })}
            />
          </>
        )}
      </section>
    </ResearchFrame>
  );
}
