import Link from "next/link";
import { filmNext, listCreators, listHooks, listIdeas, stageCounts, IDEA_STAGES } from "@autopilot/research";
import { getPool } from "../../lib/db.js";
import { ResearchHeader } from "./ui.js";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const pool = getPool();
  const [ideas, hooks, creators] = await Promise.all([listIdeas(pool), listHooks(pool), listCreators(pool)]);
  const counts = stageCounts(ideas);
  const next = filmNext(ideas);

  return (
    <main className="mx-auto max-w-md p-4">
      <ResearchHeader title="Research" current="/research" />

      <ul className="mt-4 grid grid-cols-5 gap-1 text-center text-xs">
        {IDEA_STAGES.map((s) => (
          <li key={s} className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
            <div className="text-lg font-semibold">{counts[s]}</div>
            <div className="text-neutral-500">{s}</div>
          </li>
        ))}
      </ul>

      <h2 className="mt-6 text-sm font-semibold">Film next</h2>
      {next.length === 0 ? (
        <p className="mt-1 text-sm text-neutral-500">
          Nothing scripted yet. <Link className="underline" href="/research/ideas">Add an idea</Link>.
        </p>
      ) : (
        <ol className="mt-2 divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
          {next.map((i) => (
            <li key={i.id} className="p-3">
              <div className="font-medium">{i.title}</div>
              <div className="text-neutral-500">
                {i.stage} · {i.pillar ?? "—"}
                {i.hook ? ` · "${i.hook}"` : ""}
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-6 text-sm text-neutral-500">
        {hooks.length} hook(s) · {creators.filter((c) => c.active).length} active creator(s). The weekly research brief comes from the
        research-brief skill in a Claude Code session.
      </p>
    </main>
  );
}
