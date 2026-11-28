"use client";

import { useRef, useState } from "react";
import { cx, FOCUS, Icon, Thumb } from "../ui/index.js";

/**
 * A clip poster with a play button bottom-left. Tap plays the clean mp4 inline (`/app/media/clip/<id>`, the
 * session-guarded Range route, nothing downloads before the first tap); tap the button again to pause. A
 * second corner button toggles sound (starts muted so it can autoplay on iOS). If the video can't load it
 * stays a poster. The poster itself is not a link, so it works inside a card, a popover or a dialog row.
 * Size with `className` (9:16) or `fill` to cover a sized box.
 */
export function PlayThumb({ mediaId, title, duration, fill = false, className, size = "md" }: { mediaId: string; title: string; duration?: string | null; fill?: boolean; className?: string; size?: "sm" | "md" }) {
  return (
    <span className={cx("relative block shrink-0", fill ? "h-full w-full" : "", className)}>
      <Thumb mediaId={mediaId} alt={`${title} poster`} fill={fill} className={fill ? undefined : "w-full"} />
      <PlayOverlay mediaId={mediaId} title={title} size={size} duration={duration} />
    </span>
  );
}

/**
 * The play layer alone, for a poster that is already a button (the PostCard trigger): an absolute inset-0 box
 * over the nearest `relative` parent. The box ignores the pointer except on the video and the two corner buttons.
 */
export function PlayOverlay({ mediaId, title, size = "md", duration }: { mediaId: string; title: string; size?: "sm" | "md"; /** Drawn top-right (the corner buttons use the bottom-left); hidden once the video starts. */ duration?: string | null }) {
  const v = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);

  const toggle = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setStarted(true);
    const el = v.current;
    if (!el) return; // first tap: the <video> mounts with autoPlay
    if (el.paused) void el.play().catch(() => setFailed(true));
    else el.pause();
  };
  const btn = size === "sm" ? "size-8" : "size-11";
  return (
    <span className="pointer-events-none absolute inset-0 block">
      {duration && !started ? <span className="ds-num absolute right-1 top-1 rounded-ds-xs bg-ds-invert/80 px-1 py-px text-[11px] font-semibold leading-tight text-ds-on-invert">{duration}</span> : null}
      {started && !failed ? (
        <video
          ref={v}
          autoPlay
          muted={muted}
          playsInline
          loop
          preload="auto"
          aria-label={`${title} video`}
          src={`/app/media/clip/${encodeURIComponent(mediaId)}`}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => { setFailed(true); setPlaying(false); }}
          className="pointer-events-auto absolute inset-0 h-full w-full rounded-ds-sm bg-ds-raised object-cover"
        />
      ) : null}
      {failed ? null : (
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? `Pause ${title}` : `Play ${title}`}
          aria-pressed={playing}
          className={cx("pointer-events-auto absolute bottom-0 left-0 grid size-11 place-items-center", size === "sm" && "-translate-x-0.5 translate-y-0.5", FOCUS)}
        >
          <span className={cx("grid place-items-center rounded-full bg-ds-invert text-ds-on-invert transition-colors duration-300 ease-ds", btn)}>
            {playing ? <span className="flex gap-[3px]" aria-hidden="true"><span className="h-3 w-[3px] bg-current" /><span className="h-3 w-[3px] bg-current" /></span> : <Icon name="play" size={size === "sm" ? 14 : 18} />}
          </span>
        </button>
      )}
      {started && !failed ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setMuted((m) => !m); }} aria-label={muted ? "Turn sound on" : "Mute"} aria-pressed={!muted} className={cx("pointer-events-auto absolute right-0 top-0 grid size-11 place-items-center", FOCUS)}>
          <span className="rounded-full bg-ds-invert px-2 py-1 text-[10px] font-bold uppercase leading-none tracking-[0.1em] text-ds-on-invert">{muted ? "Muted" : "Sound"}</span>
        </button>
      ) : null}
    </span>
  );
}
