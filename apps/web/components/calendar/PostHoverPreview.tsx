"use client";

import { useRef, useState } from "react";
import type { Platform } from "@autopilot/core";
import { cx, FOCUS, PLATFORM_NAME, PlatformLogo, Popover, Thumb } from "../ui/index.js";

export type PreviewData = {
  mediaId: string;
  title: string;
  caption: string;
  duration: string | null;
  platforms: Array<{ platform: Platform; time: string | null; caption: string; title: string | null }>;
};

/**
 * The PostCard thumbnail as a button that opens a 280 px Popover: a larger poster, the full caption, then
 * each platform's own text under its glyph and name. Fine pointers open it on hover (and keep it open
 * while the pointer is over the panel); touch and keyboard open it on tap / Enter; Esc and an outside
 * tap close it.
 */
export function PostHoverPreview({ data, thumbClassName }: { data: PreviewData; thumbClassName?: string }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const enter = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    cancel();
    setOpen(true);
  };
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    cancel();
    timer.current = setTimeout(() => setOpen(false), 200);
  };

  return (
    <Popover
      label={`Preview: ${data.title}`}
      width={280}
      open={open}
      onOpenChange={setOpen}
      trigger={(p) => (
        <button
          {...p}
          type="button"
          aria-label={`Preview ${data.title}`}
          onPointerEnter={enter}
          onPointerLeave={leave}
          className={cx("shrink-0 rounded-ds-sm", FOCUS)}
        >
          <Thumb mediaId={data.mediaId} alt={`${data.title} poster`} duration={data.duration} className={thumbClassName} />
        </button>
      )}
    >
      <div onPointerEnter={enter} onPointerLeave={leave} className="flex flex-col">
        <div className="h-56 p-2 pb-0">
          <Thumb mediaId={data.mediaId} alt="" fill />
        </div>
        <div className="flex flex-col gap-3 p-3">
          <p className="ds-font-display text-[20px] leading-tight text-ds-text">{data.title}</p>
          {data.caption ? <p className="whitespace-pre-wrap text-[14px] leading-snug text-ds-text">{data.caption}</p> : <p className="text-[14px] text-ds-muted">No caption yet.</p>}
          <ul className="flex flex-col divide-y divide-ds-line border-t border-ds-line">
            {data.platforms.map((pl) => (
              <li key={pl.platform} className="flex flex-col gap-1 py-2.5">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-ds-text">
                  <PlatformLogo platform={pl.platform} size={14} />
                  {PLATFORM_NAME[pl.platform]}
                  {pl.time ? <span className="ds-num ml-auto font-normal text-ds-muted">{pl.time}</span> : null}
                </span>
                {pl.title ? <span className="text-[13px] font-semibold text-ds-text">{pl.title}</span> : null}
                <span className="line-clamp-4 whitespace-pre-wrap text-[13px] leading-snug text-ds-muted">{pl.caption || "No caption yet."}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Popover>
  );
}
