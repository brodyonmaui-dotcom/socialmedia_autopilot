"use client";
import { useState } from "react";
import { posterSrc, Thumb } from "../ui/index.js";

/**
 * Library clip preview: the clean mp4 through the session-guarded same-origin route (Range-capable, so iOS
 * Safari plays it). Nothing downloads until play (`preload="none"`). If the video can't load (no clean file
 * yet, offline) it falls back to the poster.
 */
export function ClipVideo({ mediaId, hasPoster, label, duration }: { mediaId: string; hasPoster: boolean; label: string; duration: string | null }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Thumb mediaId={hasPoster ? mediaId : null} alt={`${label} poster`} duration={duration} className="w-[96px] sm:w-[160px]" />;
  return (
    <video
      controls
      playsInline
      preload="none"
      poster={hasPoster ? posterSrc(mediaId) : undefined}
      aria-label={`${label} preview`}
      src={`/app/media/clip/${encodeURIComponent(mediaId)}`}
      onError={() => setFailed(true)}
      className="aspect-[9/16] w-[96px] shrink-0 rounded-ds-sm bg-ds-raised object-cover sm:w-[160px]"
    />
  );
}
