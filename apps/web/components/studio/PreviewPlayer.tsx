"use client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { posterSrc } from "../ui/index.js";
import { activeTexts, clipLen, locate, outputTimeOf, totalDuration, type EClip, type EditorState } from "../../lib/studio/editor-state.js";
import { cx } from "../ui/index.js";

const clipUrl = (id: string) => `/app/media/clip/${encodeURIComponent(id)}`;
const soundUrl = (id: string) => `/app/media/sound/${encodeURIComponent(id)}`;
const POS: Record<string, string> = { top: "top-[12%]", center: "top-1/2 -translate-y-1/2", bottom: "bottom-[22%]" };

/**
 * One <video> that swaps src/currentTime per clip (honouring in/out/speed), CSS text overlays in the IG safe zones,
 * an <audio> for the sound. The parent owns the playhead `t`; it bumps `seekNonce` to move it. Approximate by design.
 */
export function PreviewPlayer({ state, t, playing, seekNonce, onTime, onPlaying }: { state: EditorState; t: number; playing: boolean; seekNonce: number; onTime: (t: number) => void; onPlaying: (p: boolean) => void }) {
  const vid = useRef<HTMLVideoElement>(null);
  const aud = useRef<HTMLAudioElement>(null);
  const idx = useRef(0);
  const loaded = useRef("");
  const pendingSrc = useRef<number | null>(null);
  const live = useRef({ state, t, playing });
  live.current = { state, t, playing };
  const total = totalDuration(state);

  const syncAudio = useCallback((outT: number, force = false) => {
    const a = aud.current;
    const { state: s, playing: p } = live.current;
    if (!a || !s.sound) return;
    a.volume = Math.min(1, s.sound.volume);
    const want = s.sound.offsetS + outT;
    if (force || Math.abs(a.currentTime - want) > 0.35) {
      try { a.currentTime = want; } catch { /* metadata not ready yet */ }
    }
    if (p && a.paused) void a.play().catch(() => {});
    if (!p && !a.paused) a.pause();
  }, []);

  /** Point the video at clip i, source second `src`. */
  const load = useCallback((i: number, src: number) => {
    const v = vid.current;
    const c = live.current.state.clips[i];
    if (!v || !c) return;
    idx.current = i;
    v.playbackRate = c.speed;
    v.volume = Math.min(1, live.current.state.originalVolume);
    if (loaded.current !== c.mediaId) {
      loaded.current = c.mediaId;
      pendingSrc.current = src;
      v.src = clipUrl(c.mediaId);
      v.load();
    } else {
      try { v.currentTime = src; } catch { /* ignore */ }
    }
    if (live.current.playing) void v.play().catch(() => onPlaying(false));
  }, [onPlaying]);

  const seek = useCallback((tt: number) => {
    const loc = locate(live.current.state.clips, tt);
    if (!loc) return;
    load(loc.index, loc.sourceS);
    syncAudio(tt, true);
  }, [load, syncAudio]);

  // Parent moved the playhead, or the edit changed under it.
  const sig = useMemo(() => JSON.stringify(state.clips.map((c: EClip) => [c.uid, c.mediaId, c.inS, c.outS, c.speed])), [state.clips]);
  useEffect(() => { seek(Math.min(live.current.t, Math.max(0, total - 0.01))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [seekNonce, sig]);

  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    v.volume = Math.min(1, state.originalVolume);
  }, [state.originalVolume]);

  // Play / pause + the frame loop.
  useEffect(() => {
    const v = vid.current;
    const a = aud.current;
    if (!v) return;
    if (!playing) {
      v.pause();
      a?.pause();
      return;
    }
    if (total > 0 && t >= total - 0.05) seek(0);
    void v.play().catch(() => onPlaying(false));
    syncAudio(live.current.t, true);
    let raf = 0;
    const tick = () => {
      const { state: s } = live.current;
      const c = s.clips[idx.current];
      if (c && pendingSrc.current == null) {
        if (v.currentTime >= c.outS - 0.04 || v.ended) {
          if (idx.current >= s.clips.length - 1) {
            onTime(totalDuration(s));
            onPlaying(false);
            return;
          }
          const n = s.clips[idx.current + 1]!;
          onTime(outputTimeOf(s.clips, idx.current + 1, n.inS));
          load(idx.current + 1, n.inS);
        } else {
          const outT = outputTimeOf(s.clips, idx.current, v.currentTime);
          onTime(outT);
          syncAudio(outT);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => { // sound picked/changed while idle
    if (aud.current) aud.current.load();
    syncAudio(live.current.t, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sound?.soundId, state.sound?.offsetS]);
  useEffect(() => { if (aud.current && state.sound) aud.current.volume = Math.min(1, state.sound.volume); }, [state.sound?.volume, state.sound]);

  const first = state.clips[0];
  const texts = activeTexts(state.texts, t);
  const cur = state.clips[locate(state.clips, t)?.index ?? 0];
  void clipLen;
  return (
    <div className="@container relative mx-auto aspect-[9/16] w-full overflow-hidden rounded-ds-lg border border-ds-line bg-ds-raised">
      {first ? (
        <video
          ref={vid}
          playsInline
          preload="metadata"
          poster={posterSrc((cur ?? first).mediaId)}
          aria-label="Studio preview"
          onLoadedMetadata={(e) => {
            if (pendingSrc.current != null) {
              try { e.currentTarget.currentTime = pendingSrc.current; } catch { /* ignore */ }
              pendingSrc.current = null;
              e.currentTarget.playbackRate = live.current.state.clips[idx.current]?.speed ?? 1;
            }
          }}
          className={cx("absolute inset-0 size-full", state.fit === "fill" ? "object-cover" : "object-contain")}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-[14px] text-ds-muted">Add a clip to start.</div>
      )}
      {state.sound ? <audio ref={aud} src={soundUrl(state.sound.soundId)} preload="auto" loop /> : null}
      {texts.map((x) => (
        <div key={x.uid} className={cx("pointer-events-none absolute inset-x-[8%] text-center text-[clamp(14px,5.5cqw,26px)] leading-tight text-white [text-shadow:0_1px_6px_rgb(0_0_0/0.8)]", POS[x.position], x.style === "bold" ? "font-black" : "font-normal")}>
          {x.text}
        </div>
      ))}
    </div>
  );
}
