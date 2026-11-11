import { blocklistFromEnv, classifyHook, lintText, listHooks } from "@autopilot/research";
import { getPool } from "../../../lib/db.js";
import { addHookAction } from "../actions.js";
import { button, ErrorBanner, errorFrom, input, PillarSelect, ResearchHeader, type SearchParams } from "../ui.js";

export const dynamic = "force-dynamic";

export default async function HooksPage({ searchParams }: { searchParams: SearchParams }) {
  const error = await errorFrom(searchParams);
  const hooks = await listHooks(getPool());
  const blocklist = blocklistFromEnv();

  return (
    <main className="mx-auto max-w-md p-4">
      <ResearchHeader title="Hooks" current="/research/hooks" />
      <ErrorBanner error={error} />
      <p className="mt-2 text-sm text-neutral-500">Least-used first. Voice warnings come from docs/voice.md.</p>

      <form action={addHookAction} className="mt-4 space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <input name="text" required maxLength={200} placeholder="My lats are not a fan of this…" className={input} />
        <div className="flex gap-2">
          <PillarSelect />
          <select name="source" className={input} aria-label="source">
            <option value="own">mine</option>
            <option value="creator">from a creator</option>
          </select>
          <button className={button}>Add</button>
        </div>
      </form>

      <ul className="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
        {hooks.map((h) => {
          const warnings = lintText({ text: h.text, kind: "hook", pillar: h.pillar, blocklist }).issues;
          return (
            <li key={h.id} className="p-3">
              <div className="font-medium">{h.text}</div>
              <div className="text-neutral-500">
                {h.pillar ?? "—"} · {classifyHook(h.text).join("+")} · used {h.timesUsed}× · {h.source === "own" ? "mine" : "creator pattern"}
              </div>
              {warnings.length > 0 && (
                <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">{warnings.map((w) => w.message).join(" · ")}</div>
              )}
            </li>
          );
        })}
        {hooks.length === 0 && <li className="p-3 text-neutral-500">No hooks yet.</li>}
      </ul>
    </main>
  );
}
