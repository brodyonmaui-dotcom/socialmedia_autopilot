import { getPool } from "../../lib/db.js";
import { sourceFileStatus } from "./file-status.js";
import { requireSession } from "../../lib/auth/require.js";
import { AppFrame } from "../../components/AppFrame.js";
import {
  Badge,
  Button,
  ButtonLink,
  CONTAINER,
  Chip,
  Display,
  EmptyState,
  FramedImage,
  Readout,
  SearchField,
  SectionHead,
  cx,
} from "../../components/ui/index.js";
import {
  basename,
  cellIndex,
  durationLabel,
  filterClips,
  gridHead,
  heroLines,
  parseQuery,
  pillarSummary,
  plural,
  sizeLabel,
  statusBadge,
  warningsOf,
} from "../../lib/library/view.js";

interface MediaRow {
  id: string;
  pillar: string | null;
  duration_s: string | null;
  width: number | null;
  height: number | null;
  status: string;
  qa: { warnings?: string[] } | null;
  source_path: string;
  created_at: string;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Warning chips shown per cell before the rest collapse into "+N more". */
const MAX_WARN_CHIPS = 2;

export const dynamic = "force-dynamic"; // always reflect the latest ingest, never cache stale library state
export const metadata = { title: "Library · runmysocials" };

function ClipCell({ row, index, missing }: { row: MediaRow; index: number; missing: boolean }) {
  const name = basename(row.source_path);
  const warnings = warningsOf(row);
  const status = statusBadge(row.status);
  const size = sizeLabel(row.width, row.height);
  const length = durationLabel(row.duration_s);
  return (
    <li className="col-span-2 flex min-w-0 flex-col border-l border-t border-ds-line lg:col-span-3">
      <FramedImage alt={`${name} (placeholder thumbnail)`} ratio="4/5">
        <span aria-hidden="true" className="ds-mono absolute left-3 top-3 bg-ds-bg px-1.5 py-0.5 text-ds-muted">
          {cellIndex(index)}
        </span>
        <span className="absolute bottom-3 left-3 bg-ds-bg px-2 py-1 text-[22px] font-black leading-none tracking-[-0.03em] ds-num lg:text-[28px]">
          <span className="sr-only">Length </span>
          {length}
        </span>
      </FramedImage>
      <div className="flex min-w-0 flex-1 flex-col gap-3 border-t border-ds-line p-3 lg:p-4">
        <div className="min-w-0">
          <p className="ds-mono overflow-hidden text-ellipsis whitespace-nowrap text-ds-text" title={name}>
            {name}
          </p>
          {size ? <p className="ds-mono mt-1 text-ds-faint">{size}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip>{row.pillar ?? "unsorted"}</Chip>
          <Badge tone={status.tone}>{status.label}</Badge>
          {missing ? (
            <Badge tone="danger" title="The original file is no longer at its source path. The cleaned copy in R2 is kept.">
              File missing
            </Badge>
          ) : null}
        </div>
        {warnings.length > 0 ? (
          <ul aria-label={`${plural(warnings.length, "QA warning")}`} className="flex flex-col items-start gap-1.5">
            {warnings.slice(0, MAX_WARN_CHIPS).map((w, i) => (
              <li key={i} className="max-w-full">
                <Chip tone="warn" wrap>
                  {w}
                </Chip>
              </li>
            ))}
            {warnings.length > MAX_WARN_CHIPS ? (
              <li>
                <Chip tone="warn">+{warnings.length - MAX_WARN_CHIPS} more</Chip>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const q = parseQuery((await searchParams).q);
  const pool = getPool();
  const { rows } = (await pool.query(
    "select id, pillar, duration_s, width, height, status, qa, source_path, created_at from media order by created_at desc limit 500",
  )) as { rows: MediaRow[] };
  const fileStatus = new Map(rows.map((r) => [r.id, sourceFileStatus(r.source_path)]));
  const missing = [...fileStatus.values()].filter((s) => s === "missing").length;
  const flagged = rows.filter((r) => warningsOf(r).length > 0).length;
  const ready = rows.filter((r) => r.status === "ready").length;
  const used = rows.filter((r) => r.status === "used").length;
  const shown = filterClips(rows, q);
  const head = gridHead(q, shown.length, rows.length);

  return (
    <AppFrame active="library">
      {/* Hero: clip count */}
      <section aria-label="Library summary" className="border-b border-ds-line">
        <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
          <div className="col-span-4 flex min-w-0 flex-col gap-8 py-10 lg:col-span-7 lg:gap-10 lg:py-16 lg:pr-10">
            <div className="flex items-center justify-between gap-3">
              <span className="ds-caps text-ds-muted">Ingested clips</span>
              <span className="ds-mono text-ds-faint">F12 / LIBRARY</span>
            </div>
            <Display lines={heroLines(rows.length)} />
          </div>
          <div className="col-span-4 flex min-w-0 flex-col justify-end gap-6 pb-10 lg:col-span-5 lg:border-l lg:border-ds-line lg:py-16 lg:pl-10">
            <p className="text-[20px] font-bold leading-tight tracking-[-0.02em]">Every ingested clip, newest first.</p>
            <p className="ds-note">
              Originals stay on the laptop; the cleaned copy is kept in R2.
              {missing > 0 ? ` ${plural(missing, "source file")} missing on this machine.` : ""}
            </p>
            <Readout
              items={[
                { k: "Pillars", v: pillarSummary(rows) },
                { k: "Ready", v: plural(ready, "clip") },
                { k: "Used", v: plural(used, "clip") },
                { k: "QA flags", v: plural(flagged, "clip") },
                { k: "Missing", v: plural(missing, "file") },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Search (GET ?q=, filtered in the page; no extra query) */}
      <section aria-label="Search the library" className="border-b border-ds-line">
        <form
          action="/library"
          method="get"
          role="search"
          className={cx(CONTAINER, "grid grid-cols-4 items-end gap-x-0 gap-y-3 py-6 lg:grid-cols-12 lg:py-8")}
        >
          <SearchField
            label="Search clips"
            name="q"
            defaultValue={q}
            placeholder="File name, pillar, status, warning"
            autoComplete="off"
            className="col-span-4 lg:col-span-6"
          />
          <div className="col-span-4 flex gap-2 lg:col-span-6 lg:pl-4">
            <Button type="submit" variant="outline" className="flex-1 lg:flex-none">
              Search
            </Button>
            {q ? (
              <ButtonLink href="/library" variant="ghost" className="flex-1 lg:flex-none">
                Clear
              </ButtonLink>
            ) : null}
            <ButtonLink href="/touch-up" variant="ghost" className="flex-1 lg:ml-auto lg:flex-none">
              Touch-up · {flagged}
            </ButtonLink>
          </div>
        </form>
      </section>

      <section aria-labelledby="library-grid">
        <SectionHead index="01" title={head.title} serif={head.serif} meta={head.meta} id="library-grid" />
        {shown.length === 0 ? (
          <div className={cx(CONTAINER, "border-b border-ds-line")}>
            <EmptyState
              icon={q ? "search" : "library"}
              title={q ? "No clips match" : "No clips yet"}
              body={q ? "Try a pillar (gym, meal) or part of a file name." : "Run the ingest agent on the laptop to add clips."}
              className="py-16"
            />
          </div>
        ) : (
          <div className={cx(CONTAINER, "-mt-px pb-10")}>
            <ul aria-label="Clips" className="grid grid-cols-4 border-b border-r border-ds-line lg:grid-cols-12">
              {shown.map((row, i) => (
                <ClipCell key={row.id} row={row} index={i} missing={fileStatus.get(row.id) === "missing"} />
              ))}
            </ul>
          </div>
        )}
      </section>
    </AppFrame>
  );
}
