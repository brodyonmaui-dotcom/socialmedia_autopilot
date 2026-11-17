"use client";

import { useState } from "react";
import { cx } from "./cx.js";
import { Icon } from "./Icon.js";

/** Poster URL for a media row (served by the session-guarded /app/media/poster/<id> route). */
export function posterSrc(mediaId: string): string {
  return `/app/media/poster/${encodeURIComponent(mediaId)}`;
}

/**
 * 9:16 clip poster, 8 px radius. Without a `mediaId`, or when the poster fails to load (404 before the
 * poster exists), it shows the neutral placeholder: a raised fill with a film icon. Never a striped pattern.
 * Size it with `className` (e.g. "w-[63px]") — the height follows the 9:16 ratio — or pass `fill` to cover a sized box.
 * `duration` ("0:42") sits bottom-right on the poster.
 */
export function Thumb({
  mediaId,
  alt,
  duration,
  fill = false,
  className,
}: {
  mediaId?: string | null;
  /** Describes the clip ("Leg day warm-up poster"). */
  alt: string;
  duration?: string | null;
  fill?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImg = Boolean(mediaId) && !failed;
  return (
    <span
      className={cx(
        "relative block shrink-0 overflow-hidden rounded-ds-sm bg-ds-raised",
        fill ? "h-full w-full" : "aspect-[9/16]",
        className,
      )}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element -- session-guarded same-origin poster, not optimisable
        <img src={posterSrc(mediaId!)} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span role="img" aria-label={alt} className="absolute inset-0 flex items-center justify-center text-ds-muted">
          <Icon name="film" size={20} />
        </span>
      )}
      {duration ? (
        <span className="ds-num absolute bottom-1 right-1 rounded-ds-xs bg-ds-invert/80 px-1 py-px text-[11px] font-semibold leading-tight text-ds-on-invert">{duration}</span>
      ) : null}
    </span>
  );
}
