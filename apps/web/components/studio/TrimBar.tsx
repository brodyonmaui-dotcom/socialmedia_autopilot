"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx, FOCUS, posterSrc } from "../ui/index.js";
import { LIMITS } from "../../lib/studio/editor-state.js";
import { frameCount, frameTimes, keyTrim, moveHandle, secLabel, timeToFrac, xToTime, type Handle } from "../../lib/studio/trim.js";

const FW = 54;
const FH = 96;

/** A hidden <video> of the clip, seeked to grab frames. `seekTo` draws the frame at `t` into `canvas` (latest request wins). */
function useFrames(mediaId: string, durationS: number, n: number) {
  const [frames, setFrames] = useState<string[]>([]);
  const video = useRef<HTMLVideoElement | null>(null);
  const busy = useRef(false);
  const want = useRef<{ t: number; canvas: HTMLCanvasElement } | null>(null);

  const seekOnce = useCallback((v: HTMLVideoElement, t: number) => new Promise<void>((res) => {
    const done = () => { v.removeEventListener("seeked", done); v.removeEventListener("error", done); res(); };
    v.addEventListener("seeked", done);
    v.addEventListener("error", done);
    v.currentTime = t;
  }), []);

  useEffect(() => {
    let dead = false;
    setFrames([]);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    v.src = `/app/media/clip/${encodeURIComponent(mediaId)}`;
    video.current = v;
    (async () => {
      await new Promise<void>((res) => { v.addEventListener("loadeddata", () => res(), { once: true }); v.addEventListener("error", () => res(), { once: true }); });
      if (dead || v.readyState < 2) return;
      const c = document.createElement("canvas");
      c.width = FW;
      c.height = FH;
      const g = c.getContext("2d");
      if (!g) return;
      const out: string[] = [];
      for (const t of frameTimes(durationS, n)) {
        if (dead) return;
        await seekOnce(v, t);
        try {
          const w = v.videoWidth || FW, h = v.videoHeight || FH;
          const s = Math.max(FW / w, FH / h);
          g.drawImage(v, (FW - w * s) / 2, (FH - h * s) / 2, w * s, h * s);
          out.push(c.toDataURL("image/jpeg", 0.6));
        } catch { return; } // tainted or undecodable: keep the poster fallback
        if (!dead) setFrames([...out]);
      }
    })();
    return () => { dead = true; v.removeAttribute("src"); v.load(); video.current = null; };
  }, [mediaId, durationS, n, seekOnce]);

  const seekTo = useCallback(async (t: number, canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    want.current = { t, canvas };
    if (busy.current) return;
    busy.current = true;
    while (want.current) {
      const w = want.current;
      want.current = null;
      const v = video.current;
      if (!v || v.readyState < 2) break;
      await seekOnce(v, Math.min(w.t, Math.max(0, durationS - 0.05)));
      const g = w.canvas.getContext("2d");
      const vw = v.videoWidth || FW, vh = v.videoHeight || FH;
      const s = Math.max(FW / vw, FH / vh);
      try { g?.drawImage(v, (FW - vw * s) / 2, (FH - vh * s) / 2, vw * s, vh * s); } catch { /* ignore */ }
    }
    busy.current = false;
  }, [durationS, seekOnce]);

  return { frames, seekTo };
}

/**
 * Drag-trim bar: a filmstrip of the clip with a left (in) and right (out) handle. Pointer events with pointer
 * capture and touch-action none, so a thumb drags it on iPhone without scrolling the page. The kept range is
 * framed, the rest dimmed; while a handle moves a loupe shows the frame under it. Handles are focusable sliders:
 * arrows move ±0.1 s (Shift ±1 s), Home/End jump to the edges. `onChange` gets the new in/out in seconds.
 */
export function TrimBar({ mediaId, durationS, inS, outS, onChange, label = "Trim" }: { mediaId: string; durationS: number; inS: number; outS: number; onChange: (v: { inS: number; outS: number }) => void; label?: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState<Handle | null>(null);
  const [n, setN] = useState(8);
  const { frames, seekTo } = useFrames(mediaId, durationS, n);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    setN(frameCount(el.getBoundingClientRect().width));
  }, []);

  const apply = (h: Handle, t: number) => {
    const next = moveHandle(h, t, inS, outS, durationS);
    onChange(next);
    void seekTo(h === "in" ? next.inS : next.outS, loupe.current);
  };
  const timeAt = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    return xToTime(e.clientX, r.left, r.width, durationS);
  };
  const props = (h: Handle) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.focus();
      setActive(h);
      void seekTo(h === "in" ? inS : outS, loupe.current);
    },
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => { if (active === h) apply(h, timeAt(e)); },
    onPointerUp: () => setActive(null),
    onPointerCancel: () => setActive(null),
    onKeyDown: (e: React.KeyboardEvent) => {
      const next = keyTrim(h, e.key, e.shiftKey, inS, outS, durationS);
      if (!next) return;
      e.preventDefault();
      onChange(next);
      setActive(h);
      void seekTo(h === "in" ? next.inS : next.outS, loupe.current);
    },
    onKeyUp: () => setActive(null),
    onBlur: () => setActive(null),
  });

  const a = timeToFrac(inS, durationS) * 100;
  const b = timeToFrac(outS, durationS) * 100;
  const handle = (h: Handle) => {
    const pos = h === "in" ? a : b;
    const val = h === "in" ? inS : outS;
    return (
      <button
        type="button"
        role="slider"
        aria-label={`${label} ${h === "in" ? "start" : "end"}`}
        aria-orientation="horizontal"
        aria-valuemin={h === "in" ? 0 : inS + LIMITS.minClipS}
        aria-valuemax={h === "in" ? outS - LIMITS.minClipS : durationS}
        aria-valuenow={val}
        aria-valuetext={secLabel(val)}
        style={{ left: `${pos}%`, touchAction: "none" }}
        className={cx("absolute inset-y-0 z-10 flex w-11 -translate-x-1/2 cursor-ew-resize select-none items-center justify-center", FOCUS)}
        {...props(h)}
      >
        <span className={cx("flex h-full w-3 items-center justify-center bg-ds-accent text-ds-ink transition-colors duration-300 ease-ds", active === h && "bg-ds-text")}>
          <span className="h-5 w-px bg-current" />
        </span>
        {active === h ? (
          <span className="pointer-events-none absolute bottom-full mb-2 flex flex-col items-center gap-1 border border-ds-line bg-ds-card p-1">
            <canvas ref={loupe} width={FW} height={FH} className="block bg-ds-raised" style={{ width: FW, height: FH }} />
            <span className="ds-num text-[12px] font-semibold text-ds-text">{secLabel(val)}</span>
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="mx-5">
        <div ref={bar} className="relative h-14 select-none bg-ds-raised" style={{ touchAction: "none" }}>
          <div className="absolute inset-0 flex" aria-hidden="true">
            {Array.from({ length: n }, (_, k) => (
              frames[k] ? (
                // eslint-disable-next-line @next/next/no-img-element -- client-captured data URL
                <img key={k} src={frames[k]} alt="" className="h-full min-w-0 flex-1 object-cover" draggable={false} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- session-guarded poster fallback
                <img key={k} src={posterSrc(mediaId)} alt="" className="h-full min-w-0 flex-1 object-cover opacity-60" draggable={false} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              )
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 bg-ds-card/75" style={{ width: `${a}%` }} aria-hidden="true" />
          <div className="pointer-events-none absolute inset-y-0 right-0 bg-ds-card/75" style={{ width: `${100 - b}%` }} aria-hidden="true" />
          <div className="pointer-events-none absolute inset-y-0 border-y-2 border-ds-accent" style={{ left: `${a}%`, width: `${b - a}%` }} aria-hidden="true" />
          {handle("in")}
          {handle("out")}
        </div>
      </div>
      <p className="ds-num flex justify-between text-[13px] text-ds-muted" aria-live="off">
        <span>In <b className="font-semibold text-ds-text">{secLabel(inS)}</b></span>
        <span>Length <b className="font-semibold text-ds-text">{secLabel(outS - inS)}</b></span>
        <span>Out <b className="font-semibold text-ds-text">{secLabel(outS)}</b></span>
      </p>
    </div>
  );
}
