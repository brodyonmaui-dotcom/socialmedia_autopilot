"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { queueStudioRenderAction } from "../../app/studio/actions.js";
import { Button, Chip, cx, Icon, InlineNotice, SegmentBar, SegmentButton } from "../ui/index.js";
import { fmtTime, initialState, LIMITS, problems, reducer, restore, toEdl, totalDuration } from "../../lib/studio/editor-state.js";
import { isFinished, parseStatus, POLL_MS, statusLabel, type StatusRow } from "../../lib/studio/status.js";
import type { StudioClip, StudioSound } from "../../lib/studio/types.js";
import { ClipPicker } from "./ClipPicker.js";
import { ClipStrip } from "./ClipStrip.js";
import { ExportDialog } from "./ExportDialog.js";
import { PreviewPlayer } from "./PreviewPlayer.js";
import { SoundPanel } from "./SoundPanel.js";
import { TextPanel } from "./TextPanel.js";
import { Timeline } from "./Timeline.js";

const KEY = "studio-project-v1";
type Panel = "clips" | "text" | "sound" | "look";
const PANELS: Array<[Panel, string]> = [["clips", "Clips"], ["text", "Text"], ["sound", "Sound"], ["look", "Look"]];

/** The Studio: preview + timeline on the left (stacked on phones), panels on the right. One reducer holds the project. */
export function StudioEditor({ clips, sounds, initial }: { clips: StudioClip[]; sounds: StudioSound[]; initial?: ReturnType<typeof initialState> }) {
  const [state, dispatch] = useReducer(reducer, initial ?? initialState());
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("clips");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [job, setJob] = useState<{ id: string; row: StatusRow | null } | null>(null);
  const loadedRef = useRef(false);

  // Restore after mount (not during render: server and client must match).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const r = raw ? restore(JSON.parse(raw), new Set(clips.map((c) => c.mediaId)), new Set(sounds.map((s) => s.id))) : null;
      if (r && r.clips.length) { dispatch({ type: "load", state: r }); setSelected(r.clips[0]?.uid ?? null); }
    } catch { /* private mode or corrupt: start fresh */ }
    loadedRef.current = true;
  }, [clips, sounds]);
  useEffect(() => {
    if (!loadedRef.current) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota/private mode */ }
  }, [state]);

  const total = totalDuration(state);
  const issues = problems(state);
  const used = useMemo(() => { const m = new Map<string, number>(); for (const c of state.clips) m.set(c.mediaId, (m.get(c.mediaId) ?? 0) + 1); return m; }, [state.clips]);
  const seek = useCallback((x: number) => { setT(x); setNonce((n) => n + 1); }, []);
  const sel = selected && state.clips.some((c) => c.uid === selected) ? selected : state.clips[0]?.uid ?? null;

  // Poll the render every 5 s until it finishes.
  useEffect(() => {
    if (!job || isFinished(job.row?.status ?? null)) return;
    let live = true;
    const poll = async () => {
      try {
        const res = await fetch(`/app/studio/status?ids=${encodeURIComponent(job.id)}`, { cache: "no-store" });
        const row = res.ok ? parseStatus(await res.json(), job.id) : null;
        if (live && row) setJob({ id: job.id, row });
      } catch { /* try again next tick */ }
    };
    const h = setInterval(poll, POLL_MS);
    void poll();
    return () => { live = false; clearInterval(h); };
  }, [job?.id, job?.row?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      const r = await queueStudioRenderAction(JSON.stringify(toEdl(state)));
      if (r.ok) { setConfirm(false); setJob({ id: r.editId, row: { id: r.editId, status: "queued" } }); }
      else setErr(r.error);
    } catch { setErr("Couldn't queue the render. Try again."); }
    setBusy(false);
  }

  const bad = total > 0 && (total < LIMITS.minS || total > LIMITS.maxS);
  const jobStatus = job?.row?.status ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-8">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="mx-auto w-full max-w-[220px] sm:max-w-[260px] lg:max-w-[340px]">
          <PreviewPlayer state={state} t={t} playing={playing} seekNonce={nonce} onTime={setT} onPlaying={setPlaying} />
        </div>
        <p className="text-center text-[13px] text-ds-muted">Preview is approximate, the export is exact.</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" disabled={total === 0} onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
            <Icon name="play" size={16} />
            {playing ? "Pause" : "Play"}
          </Button>
          <p className={cx("ds-num flex items-center gap-1.5 text-[14px]", bad ? "font-semibold text-ds-danger" : "text-ds-muted")}>
            {bad ? <Icon name="alert" size={16} /> : null}
            {fmtTime(total)} of {LIMITS.minS}–{LIMITS.maxS} s
          </p>
        </div>
        <Timeline state={state} t={t} selected={sel} onSelect={setSelected} onScrub={(x) => { setPlaying(false); seek(x); }} />
        <ClipStrip clips={state.clips} selected={sel} onSelect={setSelected} dispatch={dispatch} onSplit={() => { setPlaying(false); dispatch({ type: "splitAt", t }); }} />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <SegmentBar ariaLabel="Editor panels">
          {PANELS.map(([id, label]) => (
            <SegmentButton key={id} type="button" active={panel === id} onClick={() => setPanel(id)}>{label}</SegmentButton>
          ))}
        </SegmentBar>
        {panel === "clips" ? (
          <ClipPicker clips={clips} used={used} full={state.clips.length >= LIMITS.maxClips} onAdd={(c) => { dispatch({ type: "addClip", mediaId: c.mediaId, name: c.name, durationS: c.durationS }); }} />
        ) : null}
        {panel === "text" ? <TextPanel texts={state.texts} t={t} dispatch={dispatch} /> : null}
        {panel === "sound" ? <SoundPanel sounds={sounds} sound={state.sound} originalVolume={state.originalVolume} dispatch={dispatch} /> : null}
        {panel === "look" ? (
          <div className="flex flex-col gap-3">
            <SegmentBar ariaLabel="Framing">
              <SegmentButton type="button" active={state.fit === "fill"} onClick={() => dispatch({ type: "fit", fit: "fill" })}>Fill</SegmentButton>
              <SegmentButton type="button" active={state.fit === "fit"} onClick={() => dispatch({ type: "fit", fit: "fit" })}>Fit</SegmentButton>
            </SegmentBar>
            <p className="text-[13px] text-ds-muted">Fill crops to cover the screen. Fit keeps the whole frame on blurred bars.</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" disabled={total === 0} onClick={() => dispatch({ type: "cover", t })}>Use current frame as cover</Button>
              <span className="ds-num text-[13px] text-ds-muted">{state.coverS == null ? "Cover: first frame" : `Cover at ${fmtTime(state.coverS)}`}</span>
            </div>
          </div>
        ) : null}

        <div className="mt-2 flex flex-col gap-3 border-t border-ds-line pt-4">
          {issues.length ? <p className="flex items-center gap-2 text-[14px] text-ds-warn"><Icon name="alert" size={16} className="shrink-0" />{issues[0]}</p> : null}
          <Button disabled={issues.length > 0 || (!!job && !isFinished(jobStatus))} onClick={() => { setErr(null); setConfirm(true); }}>Export</Button>
          {job ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2" role="status">
                <Chip tone={jobStatus === "failed" ? "danger" : jobStatus === "done" ? "accent" : "neutral"}>{statusLabel(jobStatus ?? "queued")}</Chip>
                {jobStatus === "queued" || jobStatus === "running" ? <span className="text-[13px] text-ds-muted">Checking every 5 seconds.</span> : null}
              </div>
              {jobStatus === "failed" ? <InlineNotice tone="danger">{job.row?.error ?? "The render failed."} Your project is still here.</InlineNotice> : null}
              {jobStatus === "done" ? (
                <InlineNotice live href="/library/upload#ready" linkLabel="Ready to post">
                  Your video is ready.{" "}
                  {job.row?.resultMediaId ? <Link className="font-semibold text-ds-accent-fg underline underline-offset-2" href={`/library?clip=${encodeURIComponent(job.row.resultMediaId)}`}>Open in the library</Link> : null}
                </InlineNotice>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <ExportDialog open={confirm} state={state} busy={busy} error={err} onClose={() => setConfirm(false)} onConfirm={send} />
    </div>
  );
}
