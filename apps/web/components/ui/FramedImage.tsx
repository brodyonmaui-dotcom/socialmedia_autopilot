import type { ReactNode } from "react";
import { cx } from "./cx.js";

/** Placeholder for missing media: diagonal ds-line hairlines on ds-raised. Never a real photo. */
export const PLACEHOLDER_PATTERN =
  "bg-ds-raised bg-[repeating-linear-gradient(135deg,var(--color-ds-line)_0_1px,transparent_1px_12px)]";

/** Grayscale image (or placeholder) with a 20px inner frame line; `children` are overlays (e.g. GlassCard). */
export function FramedImage({
  src,
  alt,
  ratio = "4/5",
  children,
  className,
}: {
  src?: string;
  alt: string;
  ratio?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("relative overflow-hidden bg-ds-raised", className)} style={{ aspectRatio: ratio }}>
      {src ? (
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
