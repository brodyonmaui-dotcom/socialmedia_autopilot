"use client";

import { useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { previewAddToCalendarAction } from "../../app/library/actions.js";
import { approveAndScheduleAction } from "../../app/library/ready-actions.js";
import type { PlanLine, PlanSkip } from "../../lib/library/add-to-calendar.js";
import type { ReadyClip } from "../../lib/library/ready-to-post.js";
import { Button, Checkbox, Dialog, Icon, InlineNotice, Input, PlatformLogo, Textarea } from "../ui/index.js";
import { ClipVideo } from "./ClipVideo.js";

const PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "youtube", label: "YouTube" },
  { id: "tiktok", label: "TikTok" },
] as const;

const SKIP_WHY: Record<PlanSkip["reason"], string> = { duplicate: "already scheduled", "no-slot": "no open time", unavailable: "clip not available" };

function fmtDuration(s: number | null): string | null {
  if (s == null) return null;
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function Pending({ children, pendingText, ...rest }: { children: ReactNode; pendingText: string } & ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();
  return (
    <Button {...rest} disabled={pending || rest.disabled}>
      {pending ? pendingText : children}
    </Button>
  );
}

const toggle = (set: Set<string>, id: string, on: boolean) => {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
};

/**
 * Ready-to-post form: caption + YouTube title per clip, one platform row for the whole selection. "Approve & schedule"
 * opens a confirm listing every post, platform and time (from the calendar's own slot planner); only its button submits.
 */
export function ReadyToPostForm({ clips }: { clips: ReadyClip[] }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(clips.map((c) => c.mediaId)));
  const [platforms, setPlatforms] = useState<Set<string>>(() => new Set(PLATFORMS.map((p) => p.id)));
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<PlanLine[]>([]);
  const [skipped, setSkipped] = useState<PlanSkip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, start] = useTransition();

  const ids = clips.filter((c) => picked.has(c.mediaId)).map((c) => c.mediaId);
  const chosen = PLATFORMS.filter((p) => platforms.has(p.id)).map((p) => p.id);
  const ready = ids.length > 0 && chosen.length > 0;

  const preview = () =>
    start(async () => {
      setError(null);
      const res = await previewAddToCalendarAction(ids, chosen);
      if (!res.ok) {
        setError("Couldn't work out the times. Try again.");
        return;
      }
      setLines(res.plan.lines);
      setSkipped(res.plan.skipped);
      setOpen(true);
    });

  return (
    <form action={approveAndScheduleAction} className="flex flex-col gap-3 lg:gap-4">
      <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-ds-lg border border-ds-line bg-ds-card px-4 py-1 lg:px-5">
        <legend className="sr-only">Post to</legend>
        <span className="ds-caps text-ds-muted" aria-hidden>
          Post to
        </span>
        {PLATFORMS.map((p) => (
          <Checkbox
            key={p.id}
            name="platform"
            value={p.id}
            checked={platforms.has(p.id)}
            onChange={(e) => setPlatforms((s) => toggle(s, p.id, e.target.checked))}
            label={
              <span className="inline-flex items-center gap-2">
                <PlatformLogo platform={p.id} size={16} /> {p.label}
              </span>
            }
          />
        ))}
      </fieldset>

      <ul aria-label="Clips ready to post" className="flex flex-col gap-3 lg:gap-4">
        {clips.map((c) => {
          const on = picked.has(c.mediaId);
          const len = fmtDuration(c.durationS);
          return (
            <li key={c.mediaId} className="rounded-ds-lg border border-ds-line bg-ds-card p-4 lg:p-5">
              <div className="flex gap-4">
                <div className="shrink-0">
                  <ClipVideo mediaId={c.mediaId} hasPoster={c.hasPoster} label={c.label} duration={len} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-ds-text">{c.label}</p>
                      <p className="text-[13px] text-ds-muted">
                        {c.folder ? `Folder ${c.folder}` : "No folder"}
                        {len ? <span className="ds-num"> · {len}</span> : null}
                      </p>
                    </div>
                    <Checkbox name="mediaId" value={c.mediaId} checked={on} onChange={(e) => setPicked((s) => toggle(s, c.mediaId, e.target.checked))} label="Schedule" className="shrink-0" />
                  </div>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
                    <Textarea
                      label="Caption"
                      name={`caption:${c.mediaId}`}
                      rows={4}
                      maxLength={2200}
                      defaultValue={c.suggestion}
                      helper="A suggestion to start from. Edit freely: no places, at most 5 hashtags."
                    />
                    <Input label="YouTube title" name={`title:${c.mediaId}`} maxLength={100} autoComplete="off" helper="Leave empty and YouTube stays a draft." />
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {error ? (
        <InlineNotice tone="danger" live>
          {error}
        </InlineNotice>
      ) : null}

      <div className="sticky bottom-[calc(var(--ds-tabbar-h)+0.5rem)] z-10 flex flex-wrap items-center gap-2 rounded-ds-lg border border-ds-line bg-ds-card px-4 py-3 lg:static lg:px-5">
        <p className="mr-auto text-[14px] text-ds-muted">
          <span className="ds-num font-semibold text-ds-text">{ids.length}</span> of <span className="ds-num">{clips.length}</span> selected
        </p>
        <Pending type="submit" variant="outline" name="intent" value="draft" disabled={!ready} pendingText="Saving…">
          Save as drafts
        </Pending>
        <Button variant="solid" disabled={!ready || loading} onClick={preview}>
          {loading ? "Checking times…" : "Approve & schedule"}
        </Button>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Schedule these posts?"
        size="lg"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Pending type="submit" variant="solid" name="intent" value="approve" disabled={lines.length === 0} pendingText="Scheduling…">
              Approve & schedule {lines.length || ""}
            </Pending>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-ds-text">
            <Icon name="clock" size={16} className="shrink-0" />
            These will post automatically at these times.
          </p>
          {lines.length > 0 ? (
            <ul className="max-h-[50vh] divide-y divide-ds-line overflow-y-auto rounded-ds-sm border border-ds-line">
              {lines.map((l) => (
                <li key={`${l.mediaId}-${l.platform}`} className="flex items-center gap-3 px-3 py-2 text-[14px]">
                  <PlatformLogo platform={l.platform} size={16} />
                  <span className="min-w-0 flex-1 truncate text-ds-text">{l.label}</span>
                  <span className="ds-num shrink-0 text-ds-muted">{l.when}</span>
                </li>
              ))}
            </ul>
          ) : (
            <InlineNotice tone="warn">Nothing can be scheduled right now.</InlineNotice>
          )}
          {skipped.length > 0 ? (
            <p className="text-[13px] text-ds-muted">
              Left out: {skipped.map((s) => `${s.label}${s.platform ? ` on ${s.platform}` : ""} (${SKIP_WHY[s.reason]})`).join(", ")}.
            </p>
          ) : null}
          <p className="text-[13px] text-ds-muted">A post without a caption stays a draft. You can edit any of them in the calendar.</p>
        </div>
      </Dialog>
    </form>
  );
}
