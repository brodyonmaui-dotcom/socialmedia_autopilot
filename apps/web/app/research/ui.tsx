import type { ReactNode } from "react";
import { PILLARS } from "@autopilot/research";
import { listCreators, listHooks, listIdeas } from "@autopilot/research";
import { getPool } from "../../lib/db.js";
import { AppFrame } from "../../components/AppFrame.js";
import { CONTAINER, Display, Select, TabLinks, cx } from "../../components/ui/index.js";
import { heroLines, heroNote, researchTabs, type ResearchTab } from "../../lib/research/view.js";
import { Notice } from "../batches/ui/Notice.js";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export async function errorFrom(searchParams: SearchParams): Promise<string | undefined> {
  const e = (await searchParams).error;
  return typeof e === "string" ? e.slice(0, 200) : undefined;
}

/**
 * Research page frame: AppFrame + hero (7 / 5 split) + the Overview / Creators / Ideas / Hooks TabLinks
 * + the ?error= band. Pages call requireSession() before rendering this.
 */
export async function ResearchFrame({ current, error, children }: { current: ResearchTab; error?: string | undefined; children: ReactNode }) {
  const pool = getPool();
  const [ideas, hooks, creators] = await Promise.all([listIdeas(pool), listHooks(pool), listCreators(pool)]);
  const counts = { ideas: ideas.length, hooks: hooks.length, creators: creators.length, activeCreators: creators.filter((c) => c.active).length };
  return (
    <AppFrame active="research">
      <section aria-label="Research status" className="border-b border-ds-line">
        <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
          <div className="col-span-4 flex min-w-0 flex-col gap-8 py-10 lg:col-span-7 lg:gap-10 lg:py-16 lg:pr-10">
            <span className="ds-mono text-ds-faint">F4 / RESEARCH</span>
            <Display lines={heroLines(counts)} />
          </div>
          <div className="col-span-4 flex min-w-0 flex-col justify-end gap-3 border-t border-ds-line py-8 lg:col-span-5 lg:border-l lg:border-t-0 lg:py-16 lg:pl-10">
            <p className="ds-caps text-ds-muted">In the backlog</p>
            <p className="ds-mono text-ds-text">{heroNote(counts)}</p>
            <p className="ds-note">The weekly research brief comes from the research-brief skill in a Claude Code session.</p>
          </div>
        </div>
      </section>
      <div className="border-b border-ds-line">
        <div className={cx(CONTAINER, "py-6")}>
          <TabLinks ariaLabel="Research" items={researchTabs(current)} />
        </div>
      </div>
      <Notice error={error} />
      {children}
    </AppFrame>
  );
}

/** A bordered band holding an add/edit form: caps title, fields in a grid, actions row. */
export function FormBand({ title, note, action, children }: { title: string; note?: string; action: (fd: FormData) => Promise<void>; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-ds-line">
      <form action={action} className={cx(CONTAINER, "grid grid-cols-4 gap-x-6 gap-y-5 py-8 lg:grid-cols-12 lg:py-10")}>
        <div className="col-span-4 lg:col-span-3">
          <h2 className="ds-caps text-ds-text">{title}</h2>
          {note && <p className="ds-note mt-2">{note}</p>}
        </div>
        <div className="col-span-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-9">{children}</div>
      </form>
    </section>
  );
}

export function PillarSelect({ name = "pillar", defaultValue = "", className }: { name?: string; defaultValue?: string; className?: string }) {
  return (
    <Select label="Pillar" name={name} defaultValue={defaultValue} className={className}>
      <option value="">none</option>
      {PILLARS.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </Select>
  );
}
