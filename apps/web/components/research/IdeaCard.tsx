import Link from "next/link";
import type { IdeaCard as IdeaRow } from "../../lib/research/ideas.js";
import { forwardMove, ideaHeading, ideaSections, pillarTag, stageChip } from "../../lib/research/cards.js";
import { ButtonLink, buttonClasses, Chip, Icon, Menu, type MenuItem } from "../ui/index.js";
import { UsedToggle } from "./UsedList.js";

/**
 * One idea, read top to bottom: where it came from (small label), the line in display type, what it's
 * about, how to adapt it, then the reference link and the Used tick. `hrefWith` builds this list's URL plus
 * a dialog key (?script=, ?move=) so the dialogs keep the filters.
 */
export function IdeaCard({ idea, back, hrefWith }: { idea: IdeaRow; back: string; hrefWith: (extra: Record<string, string>) => string }) {
  const head = ideaHeading(idea);
  const sections = ideaSections(idea);
  const stage = stageChip(idea);
  const tag = pillarTag(idea.pillar);
  const next = forwardMove(idea.stage);
  const titleId = `idea-${idea.id}`;
  const menu: MenuItem[] = next ? [{ label: `Move to ${next}…`, icon: "arrowRight", href: hrefWith({ move: idea.id }), scroll: false }] : [];

  return (
    <article aria-labelledby={titleId} className="flex w-full min-w-0 flex-col rounded-ds-lg border border-ds-line bg-ds-card p-4 lg:p-5">
      <div className="flex items-start gap-3">
        <p className="ds-label min-w-0 flex-1 pt-0.5 text-ds-muted">{head.label}</p>
        {menu.length ? (
          <div className="-mr-2 -mt-2.5 lg:-mt-2">
            <Menu label={`More for this idea`} items={menu} />
          </div>
        ) : null}
      </div>
      <h3 id={titleId} className="ds-heading mt-2 max-w-[44ch] text-ds-text [overflow-wrap:anywhere]">
        {head.quoted ? <>&ldquo;{head.title}&rdquo;</> : head.title}
      </h3>

      {sections.length ? (
        <div className="mt-4 flex max-w-[68ch] flex-col gap-3">
          {sections.map((s) => (
            <div key={s.label}>
              <p className="ds-label text-ds-muted">{s.label}</p>
              <p className="mt-1 text-[15px] leading-relaxed text-ds-text">{s.text}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {idea.source === "script" && idea.script.trim() ? (
          <Link href={hrefWith({ script: idea.id })} scroll={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
            Read the script
          </Link>
        ) : null}
        {idea.referenceUrl ? (
          <ButtonLink href={idea.referenceUrl} target="_blank" rel="noopener noreferrer" variant={idea.source === "script" ? "ghost" : "outline"} size="sm">
            {idea.source === "script" ? "Source" : "Watch the reference"}
            <Icon name="arrowUpRight" size={16} />
            <span className="sr-only"> (opens in a new tab)</span>
          </ButtonLink>
        ) : null}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4">
        {tag ? <span className="ds-tag text-ds-muted">{tag}</span> : null}
        {stage ? <Chip>{stage}</Chip> : null}
        <span className="flex-1" />
        <UsedToggle kind="idea" id={idea.id} used={idea.usedAt !== null} title={head.title} back={back} />
      </div>
    </article>
  );
}
