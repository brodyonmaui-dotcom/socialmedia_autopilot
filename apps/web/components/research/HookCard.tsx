import type { HookCard as HookRow } from "../../lib/research/ideas.js";
import { hookView, pillarTag } from "../../lib/research/cards.js";
import { ButtonLink, Chip, Icon } from "../ui/index.js";
import { UsedToggle } from "./UsedList.js";

/**
 * One hook: the fill-in template in sans as the main line, the reference line it came from in quotes with
 * who said it, the link, then the topic tag and the Used tick. `warnings` = voice-lint messages (own hooks).
 */
export function HookCard({ hook, back, warnings = [] }: { hook: HookRow; back: string; warnings?: string[] }) {
  const v = hookView(hook);
  const tag = pillarTag(hook.pillar);
  const titleId = `hook-${hook.id}`;
  return (
    <article aria-labelledby={titleId} className="flex w-full min-w-0 flex-col rounded-ds-lg border border-ds-line bg-ds-card p-4 lg:p-5">
      <p id={titleId} className="max-w-[60ch] text-[17px] font-semibold leading-snug text-ds-text [overflow-wrap:anywhere]">
        {v.main}
      </p>
      {v.quote ? (
        <figure className="mt-3 max-w-[68ch] rounded-ds-sm bg-ds-raised px-3 py-2.5">
          <blockquote className="text-[15px] leading-relaxed text-ds-text">&ldquo;{v.quote}&rdquo;</blockquote>
          <figcaption className="mt-1 text-[13px] text-ds-muted">{v.attribution}</figcaption>
        </figure>
      ) : (
        <p className="mt-1 text-[13px] text-ds-muted">{v.attribution}</p>
      )}
      {warnings.length ? (
        <div className="mt-3">
          <Chip tone="warn" wrap>
            {warnings.join(" · ")}
          </Chip>
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {tag ? <span className="ds-tag text-ds-muted">{tag}</span> : null}
        <span className="flex-1" />
        {hook.referenceUrl ? (
          <ButtonLink href={hook.referenceUrl} target="_blank" rel="noopener noreferrer" variant="ghost" size="sm">
            Watch the reference
            <Icon name="arrowUpRight" size={16} />
            <span className="sr-only"> (opens in a new tab)</span>
          </ButtonLink>
        ) : null}
        <UsedToggle kind="hook" id={hook.id} used={hook.usedAt !== null} title={v.main} back={back} />
      </div>
    </article>
  );
}
