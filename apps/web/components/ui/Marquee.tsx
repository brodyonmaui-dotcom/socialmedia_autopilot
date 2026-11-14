import { cx } from "./cx.js";

export type MarqueeItem = { text: string; style?: "stroke" | "serif" | "solid" };

/** 4-point star separator in the accent colour, 0.5em. */
export function Star({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cx("inline-block size-[0.5em] shrink-0 fill-current text-ds-accent", className)}
    >
      <path d="M12 0c.6 6.2 5.8 11.4 12 12-6.2.6-11.4 5.8-12 12-.6-6.2-5.8-11.4-12-12C6.2 11.4 11.4 6.2 12 0z" />
    </svg>
  );
}

const XL_STYLE: Record<NonNullable<MarqueeItem["style"]>, string> = {
  stroke: "ds-stroke font-black uppercase tracking-[-0.04em]",
  serif: "ds-serif",
  solid: "font-black uppercase tracking-[-0.04em]",
};

/**
 * Endless ticker. The track holds the items twice and slides -50% (28s); the copy is aria-hidden.
 * Reduced motion stops it at x=0 with the first copy fully composed.
 * `size="xl"`: 120px ribbon. `size="bg"`: 20vw background type at 10%, entirely decorative.
 */
export function Marquee({
  items,
  size = "xl",
  label,
  className,
}: {
  items: MarqueeItem[];
  size?: "xl" | "bg";
  label: string;
  className?: string;
}) {
  const bg = size === "bg";
  const copy = (hidden: boolean) => (
    <div aria-hidden={hidden ? "true" : undefined} className="flex shrink-0 items-center">
      {items.map((it, i) => (
        <span key={i} className={cx("flex shrink-0 items-center whitespace-nowrap", bg ? "gap-[0.15em] pr-[0.15em]" : "gap-8 px-8")}>
          <span className={bg ? undefined : XL_STYLE[it.style ?? "stroke"]}>{it.text}</span>
          <Star />
        </span>
      ))}
    </div>
  );

  if (bg) {
    return (
      <div
        aria-hidden="true"
        className={cx(
          "pointer-events-none select-none overflow-hidden text-[20vw] font-black uppercase leading-[0.8] opacity-10",
          className,
        )}
      >
        <div className="flex w-max animate-ds-marquee">
          {copy(false)}
          {copy(true)}
        </div>
      </div>
    );
  }
  return (
    <div
      role="marquee"
      aria-label={label}
      className={cx("h-[120px] overflow-hidden border-y border-ds-line bg-ds-card", className)}
    >
      <div className="flex h-full w-max animate-ds-marquee items-center text-[48px] leading-none lg:text-[72px]">
        {copy(false)}
        {copy(true)}
      </div>
    </div>
  );
}
