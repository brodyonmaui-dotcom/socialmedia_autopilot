import type { ReactNode } from "react";
import { PILLARS } from "@autopilot/research";
import { AppFrame } from "../AppFrame.js";
import { InlineNotice, PageHeader, Select, TabLinks } from "../ui/index.js";
import { pillarWord, researchTabs, whenText, type ResearchTabId } from "../../lib/research/cards.js";
import type { ResearchStatus } from "../../lib/research/ideas.js";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const param = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 200) : undefined);

/** "New ideas every 3 days. Last refresh 5 h ago." */
export function refreshLine(status: ResearchStatus, now: Date): string {
  const last = status.lastRun?.finishedAt ?? status.lastRun?.startedAt;
  return last ? `New ideas every 3 days. Last refresh ${whenText(last, now)}.` : `New ideas every 3 days. The first refresh runs ${whenText(status.nextRunAt, now)}.`;
}

/**
 * Research frame (v3): AppFrame, the page title with one action on the right, the four tabs as links
 * (2 × 2 on phones, one row on desktop) and the ?error= / ?note= strip. Pages call requireSession() first.
 */
export function ResearchFrame({
  current,
  status,
  now,
  action,
  error,
  note,
  children,
}: {
  current: ResearchTabId;
  status: ResearchStatus;
  now: Date;
  action?: ReactNode;
  error?: string | undefined;
  note?: string | undefined;
  children: ReactNode;
}) {
  const c = status.counts;
  return (
    <AppFrame active="research">
      <PageHeader title="Research" subtitle={refreshLine(status, now)} action={action} />
      <TabLinks
        ariaLabel="Research"
        layout="grid"
        className="lg:max-w-2xl"
        items={researchTabs(current, { ideas: c.ideas, hooks: c.hooks, creators: c.activeCreators, used: c.used + c.hooksUsed })}
      />
      {error ? (
        <InlineNotice tone="danger" live className="mt-3 lg:mt-4">
          {error}
        </InlineNotice>
      ) : note ? (
        <InlineNotice live className="mt-3 lg:mt-4">
          {note}
        </InlineNotice>
      ) : null}
      {children}
    </AppFrame>
  );
}

export function PillarSelect({ name = "pillar", defaultValue = "" }: { name?: string; defaultValue?: string }) {
  return (
    <Select label="Topic" name={name} defaultValue={defaultValue}>
      <option value="">None</option>
      {PILLARS.map((p) => (
        <option key={p} value={p}>
          {pillarWord(p)}
        </option>
      ))}
    </Select>
  );
}
