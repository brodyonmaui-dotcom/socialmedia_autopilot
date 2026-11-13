import type { WeekGroups } from "../../../lib/batches/view-model.js";
import { PostCard } from "./PostCard.js";

/** Creator-local days in order, each a vertical list of posts by time; untimed items first. */
export function WeekGrid({ groups, timeZone, urls }: { groups: WeekGroups; timeZone: string; urls: Map<string, string> }) {
  return (
    <div className="mt-4 space-y-6">
      {groups.untimed.length > 0 ? (
        <section>
          <h2 className="text-base font-semibold">No time yet</h2>
          <p className="text-sm text-neutral-500">Use &ldquo;Fill times&rdquo; below, or edit a post to set one.</p>
          <ul className="mt-2 space-y-3">
            {groups.untimed.map((item) => (
              <PostCard key={item.id} item={item} time={null} timeZone={timeZone} postUrl={urls.get(item.id)} />
            ))}
          </ul>
        </section>
      ) : null}
      {groups.days.map((d) => (
        <section key={d.date}>
          <h2 className="sticky top-0 z-10 bg-white/95 py-1 text-base font-semibold dark:bg-neutral-950/95">
            {d.label} <span className="font-normal text-neutral-500">· {d.items.length} post{d.items.length === 1 ? "" : "s"}</span>
          </h2>
          {d.items.length === 0 ? (
            <p className="text-sm text-neutral-400">nothing planned</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {d.items.map(({ item, time }) => (
                <PostCard key={item.id} item={item} time={time} timeZone={timeZone} postUrl={urls.get(item.id)} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
