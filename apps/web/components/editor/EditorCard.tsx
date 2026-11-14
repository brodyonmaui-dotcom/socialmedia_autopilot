import { approveEditorRender, editCaptionAction, moveToTomorrowAction, rejectRenderAction } from "../../app/editor/actions.js";
import { formatDuration } from "../../lib/batches/view-model.js";
import { approveLabel, platformsShort, type EditorRender } from "../../lib/editor/view.js";
import { Button, Chip, ConfirmSheet, CONTAINER, FramedImage, PLATFORM_NAME, PlatformLogo, SectionHead, cx } from "../ui/index.js";
import { EditCaptionSheet } from "./EditCaptionSheet.js";

/** Bordered cells with collapsed 1 px edges (the batch screen's CELLS / CELL). */
const CELLS = "grid grid-cols-4 lg:grid-cols-12 pl-px pt-px";
const CELL = "-ml-px -mt-px";

/**
 * F15 "From your editors": one bordered cell per render (one media → up to four platform drafts).
 * Poster placeholder (never a real frame), source + pillar chips, the caption's first two lines, a slot
 * line per platform in the creator zone, warnings (block red, warn amber), then the four actions.
 * `primary` = the one render whose approve button is the view's solid black button (the newest).
 */
export function EditorCard({ r, index, from, primary }: { r: EditorRender; index: number; from: "home" | "batch"; primary: boolean }) {
  const approve = approveLabel(r);
  const blocked = r.chips.some((c) => c.tone === "danger");
  const duration = formatDuration(r.durationS);
  const n = String(index + 1).padStart(2, "0");
  const headingId = `editor-${r.key.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <li aria-labelledby={headingId} className={cx(CELL, "col-span-4 grid grid-cols-4 border lg:col-span-6 lg:grid-cols-6", blocked ? "border-ds-danger/60" : "border-ds-line")}>
      <div className="col-span-1 min-w-0 border-r border-ds-line lg:col-span-2">
        <FramedImage alt={`${r.label} poster (placeholder)`} ratio="9/16">
          {duration ? <span className="ds-mono absolute bottom-3 right-3 bg-ds-invert px-1.5 py-0.5 text-ds-on-invert">{duration}</span> : null}
        </FramedImage>
      </div>

      <div className="col-span-3 flex min-w-0 flex-col gap-3 p-4 lg:col-span-4 lg:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="ds-mono text-ds-faint">{n} / RENDER</span>
          <span className="ds-caps text-ds-muted">Draft</span>
        </div>
        <h3 id={headingId} className="text-[26px] font-black leading-[0.95] tracking-[-0.04em] [overflow-wrap:anywhere] lg:text-[36px]">
          {r.label}
        </h3>
        {r.captionLines.length > 0 ? (
          <p className="line-clamp-2 text-[15px] leading-snug text-ds-muted">{r.captionLines.join(" / ")}</p>
        ) : (
          <p className="ds-mono text-ds-faint">no caption yet</p>
        )}
        <div className="flex flex-wrap gap-2">
          {r.source ? <Chip icon="touchUp">{r.source}</Chip> : <Chip icon="touchUp">Editor</Chip>}
          {r.pillar ? <Chip>{r.pillar}</Chip> : null}
        </div>
        <ul aria-label="Platforms and slots" className="mt-auto flex flex-col divide-y divide-ds-line border-y border-ds-line">
          {r.lines.map((l) => (
            <li key={l.itemId} className="flex min-h-11 items-center gap-3 py-2">
              <PlatformLogo platform={l.platform} size={16} title={PLATFORM_NAME[l.platform]} />
              <span className="ds-caps min-w-0 flex-1 text-ds-text">{PLATFORM_NAME[l.platform]}</span>
              <span className={cx("ds-num text-[15px] font-bold", l.slot === "No slot" ? "text-ds-danger" : "text-ds-text")}>{l.slot}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="col-span-4 flex flex-col gap-4 border-t border-ds-line p-4 lg:col-span-6 lg:p-6">
        {r.chips.length > 0 ? (
          <ul aria-label="Warnings" className="flex flex-wrap gap-2">
            {r.chips.map((c) => (
              <li key={`${c.tone}|${c.label}`} className="max-w-full">
                <Chip wrap tone={c.tone}>
                  {c.tone === "danger" ? <span className="font-bold">Blocked: </span> : null}
                  {c.label}
                  <span className="ds-mono ml-1 opacity-80">· {platformsShort(c.platforms)}</span>
                </Chip>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Phone: one full-width button per row (the caps labels don't fit two-up at 390 px); two-up from sm. */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <form action={approveEditorRender.bind(null, r.batchId, r.approvableIds, from)} className="sm:col-span-2">
            <Button
              type="submit"
              variant={primary ? "solid" : "outline"}
              block
              arrow
              disabled={approve == null}
              title={approve == null ? "Fix the blocked items first" : undefined}
            >
              {approve ?? "Approve & schedule"}
            </Button>
          </form>
          <EditCaptionSheet batchId={r.batchId} from={from} label={r.label} edits={r.edits} action={editCaptionAction} />
          <form action={moveToTomorrowAction.bind(null, r.batchId, r.itemIds, from)}>
            <Button type="submit" variant="outline" block>
              Move to tomorrow
            </Button>
          </form>
          <div className="sm:col-span-2">
            <ConfirmSheet
              triggerLabel="Reject"
              triggerVariant="ghost"
              triggerTone="danger"
              triggerClassName="-ml-6"
              title={`Reject ${r.label}?`}
              body={
                <p className="ds-note">
                  Rejects {r.itemIds.length === 1 ? "this draft" : `all ${r.itemIds.length} drafts`} of this render. They stay in the batch&rsquo;s rejected
                  list and nothing is deleted. Dropping the same render again does nothing: re-render to post it.
                </p>
              }
              confirmLabel="Reject"
              formAction={rejectRenderAction.bind(null, r.batchId, r.itemIds, from)}
            />
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * The section: SectionHead + the render cells. Home hides it when empty (`hideWhenEmpty`); the batch
 * page shows a short line instead.
 */
export function EditorSection({
  renders,
  index,
  from,
  hideWhenEmpty = false,
  utcFallback = false,
}: {
  renders: EditorRender[];
  index: string;
  from: "home" | "batch";
  hideWhenEmpty?: boolean;
  utcFallback?: boolean;
}) {
  if (renders.length === 0 && hideWhenEmpty) return null;
  const posts = renders.reduce((n, r) => n + r.itemIds.length, 0);
  return (
    <section aria-labelledby="editors" className="border-b border-ds-line">
      <SectionHead
        index={index}
        title="From your"
        serif="editors"
        id="editors"
        meta={renders.length > 0 ? <span className="ds-num">{`${renders.length} render${renders.length === 1 ? "" : "s"} · ${posts} draft${posts === 1 ? "" : "s"}`}</span> : undefined}
      />
      <div className={cx(CONTAINER, renders.length > 0 ? "py-6 lg:py-10" : "py-6")}>
        {renders.length === 0 ? (
          <p className="ds-mono text-ds-muted">No editor drafts in this batch.</p>
        ) : (
          <>
            <p className="ds-note mb-6 max-w-[60ch]">
              Drafts until you tap Approve &amp; schedule. Blocked platforms stay behind; the rest go out at their slot.
              {utcFallback ? " Times in UTC: set TZ_CREATOR." : ""}
            </p>
            <ul className={CELLS}>
              {renders.map((r, i) => (
                <EditorCard key={r.key} r={r} index={i} from={from} primary={i === 0} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
