import type { FixStats, TouchUpClip } from "../../lib/library/data.js";
import { cardStage, durationText, fixingText, OP_TEXT, statsFacts, type FixAllPlan } from "../../lib/library/screen.js";
import { dismissForm, fixForm, keepFixForm, keepOriginalForm } from "../../app/library/form-actions.js";
import Link from "next/link";
import { Badge, Button, buttonClasses, CardLink, Checkbox, cx, Dialog, Icon, Thumb } from "../ui/index.js";

/** Hidden `back` field: where the form action redirects with its result note. */
const Back = ({ back }: { back: string }) => <input type="hidden" name="back" value={back} />;

/** The open issues, one plain sentence each (warn icon, never colour alone). `dismiss` adds a Dismiss per issue. */
export function IssueList({ clip, back, dismiss }: { clip: TouchUpClip; back: string; dismiss: boolean }) {
  return (
    <ul className="flex flex-col divide-y divide-ds-line" aria-label={`Issues with ${clip.label}`}>
      {clip.issues.map((i) => (
        <li key={i.code} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-ds-warn" />
          <p className="min-w-0 flex-1 pt-px text-[15px] leading-snug text-ds-text">{i.text}</p>
          {dismiss ? (
            <form action={dismissForm} className="-my-2.5 shrink-0 lg:-my-1.5">
              <Back back={back} />
              <input type="hidden" name="mediaId" value={clip.mediaId} />
              <input type="hidden" name="code" value={i.code} />
              <Button type="submit" variant="ghost" size="sm" aria-label={`Dismiss: ${i.text}`}>
                Dismiss
              </Button>
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** "Fix it" for one clip; opt-in steps (silent pauses) as a checkbox, off by default. */
export function FixItForm({ clip, back, solid = false, block = false }: { clip: TouchUpClip; back: string; solid?: boolean; block?: boolean }) {
  return (
    <form action={fixForm} className={cx("flex flex-col gap-1", block && "w-full")}>
      <Back back={back} />
      <input type="hidden" name="mediaId" value={clip.mediaId} />
      {clip.optionalOps.length ? clip.fixOps.map((o) => <input key={o} type="hidden" name="op" value={o} />) : null}
      {clip.optionalOps.map((o) => (
        <Checkbox key={o} name="op" value={o} label={`Also: ${OP_TEXT[o].toLowerCase()}`} description="Changes the pacing, so it's off unless you tick it." />
      ))}
      <Button type="submit" variant={solid ? "solid" : "outline"} size={solid ? "md" : "sm"} block={block} className={block ? undefined : "self-start"}>
        Fix it
      </Button>
    </form>
  );
}

function Facts({ title, stats }: { title: string; stats: FixStats | null }) {
  return (
    <div className="min-w-0">
      <p className="ds-label text-ds-text">{title}</p>
      <dl className="mt-1 flex flex-col gap-0.5 text-[13px] leading-snug">
        {statsFacts(stats).map((f) => (
          <div key={f.label} className="flex flex-wrap gap-x-1.5">
            <dt className="text-ds-muted">{f.label}</dt>
            <dd className="ds-num font-semibold text-ds-text">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Before → after: the two posters side by side, length / loudness / size under each. */
export function BeforeAfter({ clip }: { clip: TouchUpClip }) {
  if (clip.fix.state !== "done") return null;
  const f = clip.fix;
  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <figure className="flex w-[120px] min-w-0 flex-col gap-2 sm:w-[136px]">
        <Thumb mediaId={clip.hasPoster ? clip.mediaId : null} alt={`${clip.label} before the fix`} duration={durationText(f.before?.durationS ?? clip.durationS)} className="w-full" />
        <figcaption>
          <Facts title="Before" stats={f.before} />
        </figcaption>
      </figure>
      <Icon name="arrowRight" size={20} className="mt-24 shrink-0 text-ds-muted" />
      <figure className="flex w-[120px] min-w-0 flex-col gap-2 sm:w-[136px]">
        <Thumb mediaId={f.fixedMediaId} alt={`${clip.label} after the fix`} duration={durationText(f.after?.durationS)} className="w-full" />
        <figcaption>
          <Facts title="After" stats={f.after} />
        </figcaption>
      </figure>
    </div>
  );
}

/** The state block + its buttons, shared by the Touch-up card and the Library clip Dialog. */
export function FixState({ clip, back, refreshHref, solidFix = false }: { clip: TouchUpClip; back: string; refreshHref: string; solidFix?: boolean }) {
  const stage = cardStage(clip);
  const fixId = "fixId" in clip.fix ? clip.fix.fixId : null;
  switch (stage) {
    case "fix":
      return <FixItForm clip={clip} back={back} solid={solidFix} />;
    case "unfixable":
      return <p className="text-[14px] leading-snug text-ds-muted">Fix it can&rsquo;t change this one. Re-export the clip, or dismiss the issue if it&rsquo;s on purpose.</p>;
    case "fixing":
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge>Fixing…</Badge>
          <p className="min-w-0 flex-1 basis-48 text-[14px] leading-snug text-ds-muted">{fixingText(clip.fix)} The original stays as it is.</p>
          <Link href={refreshHref} scroll={false} className={buttonClasses({ variant: "ghost", size: "sm" })}>
            Refresh
          </Link>
        </div>
      );
    case "review":
      return (
        <div className="flex flex-col gap-4">
          <BeforeAfter clip={clip} />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <form action={keepFixForm}>
              <Back back={back} />
              <input type="hidden" name="fixId" value={fixId ?? ""} />
              <Button type="submit" variant="solid" size="sm" block>
                Keep the fix
              </Button>
            </form>
            <form action={keepOriginalForm}>
              <Back back={back} />
              <input type="hidden" name="fixId" value={fixId ?? ""} />
              <Button type="submit" variant="outline" size="sm" block>
                Keep the original
              </Button>
            </form>
          </div>
          <p className="text-[13px] leading-snug text-ds-muted">Keeping the fix moves draft posts to it. Approved posts keep the file you approved.</p>
        </div>
      );
    case "failed":
      return (
        <div className="flex flex-col gap-3">
          <p className="flex items-start gap-2 text-[14px] leading-snug text-ds-text">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-ds-danger" />
            <span className="min-w-0">
              <span className="font-semibold">The fix didn&rsquo;t work.</span> {clip.fix.state === "failed" ? clip.fix.reason : null}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {clip.fixOps.length ? (
              <form action={fixForm}>
                <Back back={back} />
                <input type="hidden" name="mediaId" value={clip.mediaId} />
                <Button type="submit" variant="outline" size="sm">
                  Try again
                </Button>
              </form>
            ) : null}
            <form action={keepOriginalForm}>
              <Back back={back} />
              <input type="hidden" name="fixId" value={fixId ?? ""} />
              <Button type="submit" variant="ghost" size="sm">
                Keep the original
              </Button>
            </form>
          </div>
        </div>
      );
  }
}

/** One clip on Touch-up: poster, label, the issues in plain words, then its state. */
/** `wide`: the card spans the row on desktop with its state block on the right (used for a fix to review). */
export function TouchUpCard({ clip, back, wide = false }: { clip: TouchUpClip; back: string; wide?: boolean }) {
  const stage = cardStage(clip);
  const titleId = `tu-${clip.mediaId}`;
  const meta = [clip.pillar?.toUpperCase(), durationText(clip.durationS)].filter(Boolean);
  return (
    <article
      id={`clip-${clip.mediaId}`}
      aria-labelledby={titleId}
      className={cx("flex h-full min-w-0 flex-col gap-4 rounded-ds-lg border border-ds-line bg-ds-card p-4 lg:p-5", wide && "lg:grid lg:grid-cols-2 lg:gap-6")}
    >
      <div className={cx("grid content-start gap-x-3 gap-y-3", stage === "review" ? "grid-cols-1" : "grid-cols-[63px_minmax(0,1fr)]")}>
        {stage === "review" ? null : <Thumb mediaId={clip.hasPoster ? clip.mediaId : null} alt={`${clip.label} poster`} className="w-[63px] sm:row-span-2" />}
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="ds-font-display overflow-hidden text-ellipsis whitespace-nowrap pt-0.5 text-[20px] leading-tight text-ds-text lg:text-[22px]">
              {clip.label}
            </h3>
            {meta.length ? <p className="ds-num mt-1 text-[13px] text-ds-muted">{meta.join(" · ")}</p> : null}
          </div>
          <CardLink href={clip.libraryHref}>Find in library</CardLink>
        </div>
        <div className={cx("min-w-0 flex flex-col gap-3", stage === "review" ? null : "col-span-2 sm:col-span-1 sm:col-start-2")}>
          <IssueList clip={clip} back={back} dismiss={stage === "fix" || stage === "unfixable"} />
          {stage === "review" ? <p className="text-[14px] leading-snug text-ds-muted">The fix is ready. Compare the two and choose; nothing changes in your posts until you do.</p> : null}
        </div>
      </div>
      <div className={cx("mt-auto border-t border-ds-line pt-4", wide && "lg:mt-0 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0")}>
        <FixState clip={clip} back={back} refreshHref={back} />
      </div>
    </article>
  );
}

/** `?fixall=1`: what Fix all will do, per issue, before anything is queued. Originals are kept. */
export function FixAllDialog({ plan, closeHref, back }: { plan: FixAllPlan; closeHref: string; back: string }) {
  const n = plan.ids.length;
  return (
    <Dialog
      open
      closeHref={closeHref}
      title={n ? `Fix ${n === 1 ? "1 clip" : `${n} clips`}?` : "Nothing to fix right now"}
      footer={
        <>
          <Link href={closeHref} scroll={false} className={buttonClasses({ variant: "outline" })}>
            Cancel
          </Link>
          {n ? (
            <form action={fixForm}>
              <Back back={back} />
              {plan.ids.map((id) => (
                <input key={id} type="hidden" name="mediaId" value={id} />
              ))}
              <Button type="submit" variant="solid" block>
                Fix {n === 1 ? "1 clip" : `${n} clips`}
              </Button>
            </form>
          ) : null}
        </>
      }
    >
      {n ? (
        <div className="flex flex-col gap-5">
          <div>
            <p className="ds-label text-ds-muted">What&rsquo;s wrong</p>
            <ul className="mt-1 flex flex-col divide-y divide-ds-line" aria-label="Issues that will be fixed">
              {plan.issues.map((i) => (
                <li key={i.code} className="flex items-center gap-2 py-2 text-[15px] text-ds-text">
                  {i.name}
                  <span className="ds-num ml-auto font-semibold">{i.n === 1 ? "1 clip" : `${i.n} clips`}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="ds-label text-ds-muted">What Fix it does</p>
            <ul className="mt-2 flex flex-col gap-1.5" aria-label="Fix steps">
              {plan.steps.map((s) => (
                <li key={s} className="flex items-start gap-2 text-[15px] leading-snug text-ds-text">
                  <Icon name="check" size={16} className="mt-0.5 shrink-0 text-ds-accent-fg" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[14px] leading-snug text-ds-text">
            <span className="font-semibold">Originals are kept.</span> You see each result and choose to keep the fix or the original. Silent pauses are left alone.
          </p>
        </div>
      ) : (
        <p className="text-[15px] leading-snug text-ds-muted">Every clip here is already being fixed, waiting for your choice, or needs a re-export.</p>
      )}
    </Dialog>
  );
}
