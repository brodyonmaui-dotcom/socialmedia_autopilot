"use client";

import Link from "next/link";
import { useEffect, useState, type PointerEvent, type ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { PLACEHOLDER_PATTERN } from "./FramedImage.js";
import { Icon } from "./Icon.js";

export type RevealItem = {
  id: string;
  index: string;
  title: string;
  meta: string;
  /** e.g. <PlatformLogo /> */
  trailing?: ReactNode;
  href?: string;
  image?: { src?: string; alt: string };
};

/** Hidden → revealed wipe (right to left), 600ms high-inertia. */
export const REVEAL_CLIP =
  "[clip-path:inset(0_0_0_100%)] group-hover:[clip-path:inset(0_0_0_0)] group-focus-visible:[clip-path:inset(0_0_0_0)] transition-[clip-path] duration-[600ms] ease-ds";

const ROW =
  "group relative grid grid-cols-4 lg:grid-cols-12 items-center border-b border-ds-line min-h-[120px] lg:min-h-[300px] overflow-hidden";

function Media({ image, className }: { image: NonNullable<RevealItem["image"]>; className?: string }) {
  return (
    <div className={cx("overflow-hidden bg-ds-raised", className)}>
      {image.src ? (
        // eslint-disable-next-line @next/next/no-img-element -- local thumbnails
        <img src={image.src} alt={image.alt} className="size-full object-cover grayscale" />
      ) : (
        <div role="img" aria-label={image.alt} className={cx("size-full", PLACEHOLDER_PATTERN)} />
      )}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-ds-accent/20 mix-blend-multiply" />
    </div>
  );
}

/** True only on devices with a precise pointer (mouse/trackpad); false during SSR. */
function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: fine)");
    const update = () => setFine(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return fine;
}

function trackPointer(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--x", `${e.clientX - r.left}px`);
  el.style.setProperty("--y", `${e.clientY - r.top}px`);
}

function Row({ item, fine }: { item: RevealItem; fine: boolean }) {
  const body = (
    <>
      <span className="ds-mono relative z-10 col-span-1 self-start pt-6 text-ds-muted lg:self-center lg:pt-0">
        {item.index}
      </span>
      <span className={cx("relative z-10 col-span-3 py-6 lg:col-span-6 lg:py-0", item.image && "pr-20 lg:pr-0")}>
        <span className="block text-[28px] font-bold leading-[0.95] tracking-[-0.03em] text-ds-text transition-[letter-spacing] duration-[var(--ds-dur)] ease-ds group-hover:ds-serif group-hover:font-normal group-focus-visible:ds-serif group-focus-visible:font-normal lg:text-[56px]">
          {item.title}
        </span>
        <span className="ds-mono mt-2 flex items-center gap-2 text-ds-muted lg:hidden">
          {item.meta}
          {item.trailing && <span className="text-ds-text">{item.trailing}</span>}
        </span>
      </span>
      <span className="ds-mono relative z-10 hidden text-ds-muted lg:col-span-3 lg:block">{item.meta}</span>
      {item.trailing && (
        <span className="relative z-10 hidden justify-end pr-8 text-ds-text lg:col-span-2 lg:flex">{item.trailing}</span>
      )}

      {item.image && (
        <>
          {/* Phone/tablet: always-visible 64px thumbnail on the right. */}
          <Media image={item.image} className="absolute right-0 top-1/2 size-16 -translate-y-1/2 lg:hidden" />
          {/* Desktop: right 5 columns, wiped in on hover/focus. */}
          <Media image={item.image} className={cx("absolute inset-y-0 right-0 hidden w-[41.666%] lg:block", REVEAL_CLIP)} />
        </>
      )}

      {fine && (
        <span
          aria-hidden="true"
          className="ds-caps pointer-events-none absolute z-20 hidden size-20 -translate-x-1/2 -translate-y-1/2 scale-50 items-center justify-center gap-1 rounded-full bg-ds-invert text-ds-on-invert opacity-0 transition-[left,top,opacity,scale] duration-300 ease-ds group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 lg:flex"
          style={{ left: "var(--x, 83%)", top: "var(--y, 50%)" }}
        >
          View
          <Icon name="arrowUpRight" size={12} strokeWidth={2} />
        </span>
      )}
    </>
  );

  const onPointerMove = fine ? trackPointer : undefined;
  return item.href ? (
    <Link href={item.href} onPointerMove={onPointerMove} className={cx(ROW, FOCUS)}>
      {body}
    </Link>
  ) : (
    <div onPointerMove={onPointerMove} className={ROW}>
      {body}
    </div>
  );
}

/**
 * Editorial list ("Up next"): index, big title (turns serif italic on hover/focus), mono meta, trailing logo.
 * Desktop wipes a grayscale image into the right 5 columns and shows a cursor-following "View" circle
 * (precise pointers only). Phones always show a 64px thumbnail and the whole row is the link.
 */
export function RevealList({ items, label, className }: { items: RevealItem[]; label: string; className?: string }) {
  const fine = useFinePointer();
  return (
    <ul aria-label={label} className={cx("border-t border-ds-line", className)}>
      {items.map((item) => (
        <li key={item.id}>
          <Row item={item} fine={fine} />
        </li>
      ))}
    </ul>
  );
}
