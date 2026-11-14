import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { AppFrame } from "../../components/AppFrame.js";
import {
  Badge,
  ButtonLink,
  CONTAINER,
  Chip,
  Display,
  EmptyState,
  ListRow,
  ListRows,
  PLACEHOLDER_PATTERN,
  Readout,
  SectionHead,
  cx,
} from "../../components/ui/index.js";
import { basename, durationLabel, libraryHref, plural, warningsOf } from "../../lib/library/view.js";

interface MediaRow {
  id: string;
  pillar: string | null;
  duration_s: string | null;
  qa: { warnings?: string[] } | null;
  source_path: string;
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Touch-up · runmysocials" };

/** 40×50 placeholder thumbnail (4:5) for the row avatar. Never a real photo. */
function Thumb() {
  return <span aria-hidden="true" className={cx("block h-[50px] w-10 shrink-0 border border-ds-line", PLACEHOLDER_PATTERN)} />;
}

/** Media with ed-qa warnings — flagged for a human look before it goes into a batch, not auto-fixed. */
export default async function TouchUpQueuePage() {
  await requireSession();
  const pool = getPool();
  const { rows } = (await pool.query(
    `select id, pillar, duration_s, qa, source_path from media
     where status = 'ready' and jsonb_array_length(coalesce(qa->'warnings', '[]'::jsonb)) > 0
     order by jsonb_array_length(qa->'warnings') desc, created_at desc
     limit 500`,
  )) as { rows: MediaRow[] };
  const warningTotal = rows.reduce((n, r) => n + warningsOf(r).length, 0);

  return (
    <AppFrame active="touch-up">
      {/* Hero: queue size */}
      <section aria-label="Touch-up summary" className="border-b border-ds-line">
        <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
          <div className="col-span-4 flex min-w-0 flex-col gap-8 py-10 lg:col-span-7 lg:gap-10 lg:py-16 lg:pr-10">
            <div className="flex items-center justify-between gap-3">
              <span className="ds-caps text-ds-muted">Ed-qa flags</span>
              <span className="ds-mono text-ds-faint">F12 / TOUCH-UP</span>
            </div>
            <Display lines={[{ text: "Touch-up", style: "stroke" }, { text: "to check", style: "serif" }, { text: String(rows.length) }]} />
          </div>
          <div className="col-span-4 flex min-w-0 flex-col justify-end gap-6 pb-10 lg:col-span-5 lg:border-l lg:border-ds-line lg:py-16 lg:pl-10">
            <p className="text-[20px] font-bold leading-tight tracking-[-0.02em]">Ready clips with ed-qa warnings.</p>
            <p className="ds-note">Flagged for a human look before they go into a batch. Nothing here was auto-fixed.</p>
            <Readout
              items={[
                { k: "Clips", v: plural(rows.length, "clip") },
                { k: "Warnings", v: plural(warningTotal, "warning") },
                { k: "Order", v: "most warnings first" },
              ]}
            />
            <ButtonLink href="/library" variant="outline" className="self-start">
              Open library
            </ButtonLink>
          </div>
        </div>
      </section>

      <section aria-labelledby="touchup-list">
        <SectionHead index="01" title="Flagged" serif="clips" meta={plural(rows.length, "clip")} id="touchup-list" />
        {rows.length === 0 ? (
          <div className={cx(CONTAINER, "border-b border-ds-line")}>
            <EmptyState icon="check" title="Nothing to touch up" body="Ready clips with ed-qa warnings show up here." className="py-16" />
          </div>
        ) : (
          <div className={cx(CONTAINER, "grid grid-cols-4 pb-10 lg:grid-cols-12")}>
            <ListRows label="Flagged clips" className="col-span-4 border-b border-ds-line lg:col-span-8">
              {rows.map((row) => {
                const warnings = warningsOf(row);
                return (
                  <ListRow
                    key={row.id}
                    avatar={<Thumb />}
                    title={basename(row.source_path)}
                    subtitle={`${(row.pillar ?? "unsorted").toUpperCase()} · ${durationLabel(row.duration_s)}`}
                    trailing={<Badge tone="warn">{plural(warnings.length, "warning")}</Badge>}
                  >
                    <ul aria-label="QA warnings" className="flex flex-col items-start gap-1.5 pl-[52px]">
                      {warnings.map((w, i) => (
                        <li key={i} className="max-w-full">
                          <Chip tone="warn" wrap>
                            {w}
                          </Chip>
                        </li>
                      ))}
                    </ul>
                    <div className="pl-[52px]">
                      <ButtonLink href={libraryHref(row.source_path)} variant="outline" size="sm">
                        Find in library
                      </ButtonLink>
                    </div>
                  </ListRow>
                );
              })}
            </ListRows>
          </div>
        )}
      </section>
    </AppFrame>
  );
}
