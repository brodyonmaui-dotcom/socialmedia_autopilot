import { listCreators } from "@autopilot/research";
import { getPool } from "../../../lib/db.js";
import { addCreatorAction, toggleCreatorAction } from "../actions.js";
import { button, ErrorBanner, errorFrom, input, PillarSelect, ResearchHeader, smallButton, type SearchParams } from "../ui.js";

export const dynamic = "force-dynamic";

export default async function CreatorsPage({ searchParams }: { searchParams: SearchParams }) {
  const error = await errorFrom(searchParams);
  const creators = await listCreators(getPool());

  return (
    <main className="mx-auto max-w-md p-4">
      <ResearchHeader title="Creators" current="/research/creators" />
      <ErrorBanner error={error} />
      <p className="mt-2 text-sm text-neutral-500">
        Public handles only. Notes say why you follow them, never where they are.
      </p>

      <form action={addCreatorAction} className="mt-4 space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="flex gap-2">
          <select name="platform" className={input} aria-label="platform" defaultValue="instagram">
            <option value="instagram">instagram</option>
            <option value="tiktok">tiktok</option>
            <option value="youtube">youtube</option>
            <option value="snapchat">snapchat</option>
          </select>
          <input name="handle" required placeholder="@handle or profile link" className={input} autoCapitalize="none" />
        </div>
        <div className="flex gap-2">
          <PillarSelect />
          <input name="followers" inputMode="numeric" placeholder="followers" className={input} />
        </div>
        <input name="notes" maxLength={500} placeholder="why (e.g. great deadpan hooks)" className={input} />
        <button className={button}>Save</button>
      </form>

      <ul className="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
        {creators.map((c) => (
          <li key={c.id} className={`flex items-center justify-between gap-3 p-3 ${c.active ? "" : "opacity-50"}`}>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">@{c.handle}</div>
              <div className="truncate text-neutral-500">
                {c.platform} · {c.pillar ?? "—"}
                {c.followers !== null ? ` · ${c.followers.toLocaleString("en-US")}` : ""}
                {c.notes ? ` · ${c.notes}` : ""}
              </div>
            </div>
            <form action={toggleCreatorAction}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="active" value={String(!c.active)} />
              <button className={smallButton}>{c.active ? "pause" : "resume"}</button>
            </form>
          </li>
        ))}
        {creators.length === 0 && <li className="p-3 text-neutral-500">No creators yet.</li>}
      </ul>
    </main>
  );
}
