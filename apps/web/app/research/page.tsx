import { filmNext, listIdeas, stageCounts, IDEA_STAGES } from "@autopilot/research";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { Badge, CONTAINER, EmptyState, RevealList, SectionHead, cx, type RevealItem } from "../../components/ui/index.js";
import { ideaMeta, stageBadge, two } from "../../lib/research/view.js";
import { ResearchFrame } from "./ui.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Research · runmysocials" };

export default async function ResearchPage() {
  await requireSession();
  const ideas = await listIdeas(getPool());
  const counts = stageCounts(ideas);
  const next = filmNext(ideas);
  const items: RevealItem[] = next.map((i, n) => {
    const s = stageBadge(i.stage);
    return { id: i.id, index: two(n + 1), title: i.title, meta: ideaMeta(i), href: "/research/ideas", trailing: <Badge tone={s.tone}>{s.label}</Badge> };
  });

  return (
    <ResearchFrame current="overview">
      <section aria-label="Backlog stages" className="border-b border-ds-line">
        <ul className={cx(CONTAINER, "grid grid-cols-5 divide-x divide-ds-line")}>
          {IDEA_STAGES.map((s) => (
            <li key={s} className="flex min-w-0 flex-col gap-2 px-2 py-6 first:pl-0 last:pr-0 lg:px-6 lg:py-8">
              <span className="ds-num text-[32px] font-black leading-none tracking-[-0.04em] lg:text-[56px]">{counts[s]}</span>
              <span className="ds-caps overflow-hidden text-ellipsis text-ds-muted">{s}</span>
            </li>
          ))}
        </ul>
      </section>
      <SectionHead index="01" title="Film" serif="next" meta={`${next.length} queued`} />
      <div className={cx(CONTAINER, "-mt-px pb-10")}>
        {items.length === 0 ? (
          <EmptyState icon="research" title="Nothing scripted yet" body="Add an idea on the Ideas tab and give it a script." className="border border-ds-line" />
        ) : (
          <RevealList label="Film next" items={items} />
        )}
      </div>
    </ResearchFrame>
  );
}
