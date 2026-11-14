import { CONTAINER, cx } from "../../../components/ui/index.js";
import type { BatchItemView } from "../../../lib/batches/types.js";
import type { WeekGroups } from "../../../lib/batches/view-model.js";
import { CELLS } from "./nav.js";
import { PostCard } from "./PostCard.js";

const two = (n: number) => String(n).padStart(2, "0");

function DayHead({ n, label, count, hint }: { n: string; label: string; count: number; hint?: string }) {
  return (
    <div className="border-b border-ds-line">
      <div className={cx(CONTAINER, "grid grid-cols-4 items-baseline gap-y-1 py-4 lg:grid-cols-12")}>
        <span className="ds-mono col-span-1 text-ds-muted">{n}</span>
        <h3 className="ds-caps col-span-2 text-ds-text lg:col-span-5">{label}</h3>
        <span className="ds-mono col-span-1 text-right text-ds-muted lg:col-span-6">
          {count === 0 ? "nothing planned" : `${count} post${count === 1 ? "" : "s"}`}
        </span>
        {hint ? <p className="col-span-3 col-start-2 text-[15px] text-ds-muted lg:col-span-11">{hint}</p> : null}
      </div>
    </div>
  );
}

function Cards({ items, timeZone, dayLabel, openReset }: { items: Array<{ item: BatchItemView; time: string | null }>; timeZone: string; dayLabel?: string; openReset?: string }) {
  return (
    <div className="border-b border-ds-line">
      <div className={cx(CONTAINER, "py-6 lg:py-8")}>
        <ul className={CELLS}>
          {items.map(({ item, time }, i) => (
            <PostCard key={item.id} item={item} time={time} timeZone={timeZone} index={two(i + 1)} dayLabel={dayLabel} openReset={openReset === item.id} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Creator-local days in order (a caps row each), posts as bordered cells: 1 per row on phones, 2 on desktop. Untimed first. */
export function WeekGrid({ groups, timeZone, openReset }: { groups: WeekGroups; timeZone: string; openReset?: string | undefined }) {
  return (
    <div>
      {groups.untimed.length > 0 ? (
        <section aria-label="No time yet">
          <DayHead n="00" label="No time yet" count={groups.untimed.length} hint="Use “Fill times” above, or edit a post to set one." />
          <Cards items={groups.untimed.map((item) => ({ item, time: null }))} timeZone={timeZone} openReset={openReset} />
        </section>
      ) : null}
      {groups.days.map((d, i) => (
        <section key={d.date} aria-label={d.label}>
          <DayHead n={two(i + 1)} label={d.label} count={d.items.length} />
          {d.items.length > 0 ? <Cards items={d.items} timeZone={timeZone} dayLabel={d.label} openReset={openReset} /> : null}
        </section>
      ))}
    </div>
  );
}

/** Rejected posts, collapsed under a caps summary row. */
export function RejectedList({ items, timeZone }: { items: BatchItemView[]; timeZone: string }) {
  if (items.length === 0) return null;
  return (
    <details className="group border-b border-ds-line">
      <summary className={cx(CONTAINER, "grid min-h-14 cursor-pointer list-none grid-cols-4 items-center lg:grid-cols-12")}>
        <span className="ds-mono col-span-1 text-ds-muted">--</span>
        <span className="ds-caps col-span-2 text-ds-text lg:col-span-5">Rejected ({items.length})</span>
        <span className="ds-mono col-span-1 text-right text-ds-accent-fg lg:col-span-6">
          <span className="group-open:hidden">show</span>
          <span className="hidden group-open:inline">hide</span>
        </span>
      </summary>
      <Cards items={items.map((item) => ({ item, time: null }))} timeZone={timeZone} />
    </details>
  );
}
