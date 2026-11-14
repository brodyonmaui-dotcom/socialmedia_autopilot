import type { ReactNode } from "react";
import { cx } from "./cx.js";

/** Placeholder for missing media: diagonal ds-line hairlines on ds-raised. Never a real photo. */
export const PLACEHOLDER_PATTERN =
  "bg-ds-raised bg-[repeating-linear-gradient(135deg,var(--color-ds-line)_0_1px,transparent_1px_12px)]";

/**
 * Grayscale image (or placeholder) with a 20px inner frame line; `children` are overlays (e.g. GlassCard).
 * `ratio` sets the aspect ratio via a CSS var, so a page can drop it at a breakpoint (`lg:aspect-auto` + `h-full`).
 * `video` (variant): a same-origin or blob: clip URL shown as a muted, inline, grayscale <video> with native
 * controls, layered over the placeholder pattern (so a clip that fails to load still shows the pattern).
 */
export function FramedImage({
  src,
  video,
  alt,
  ratio = "4/5",
  children,
  className,
}: {
  src?: string;
  video?: string;
  alt: string;
  ratio?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx("relative aspect-[var(--ds-ar)] overflow-hidden bg-ds-raised", className)}
      style={{ ["--ds-ar" as string]: ratio }}
    >
      {video ? (
        <>
          <div aria-hidden="true" className={cx("absolute inset-0", PLACEHOLDER_PATTERN)} />
          <video
            src={video}
            aria-label={alt}
            muted
            playsInline
            loop
            controls
            preload="metadata"
            className="absolute inset-0 size-full object-cover grayscale"
          />
        </>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element -- local thumbnails, no optimizer needed
        <img src={src} alt={alt} className="absolute inset-0 size-full object-cover grayscale" />
      ) : (
        <div role="img" aria-label={alt} className={cx("absolute inset-0", PLACEHOLDER_PATTERN)} />
      )}
      <div aria-hidden="true" className="pointer-events-none absolute inset-5 border border-ds-bg/70" />
      {children}
    </div>
  );
}
