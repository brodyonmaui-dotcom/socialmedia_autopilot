import { cx } from "./cx.js";
import { CONTAINER } from "./GridLines.js";

/** One big serif-italic line (e.g. the weekly report's headline finding) with a small caps source. */
export function Statement({ text, source, className }: { text: string; source?: string; className?: string }) {
  return (
    <section className={cx("border-y border-ds-line py-16 lg:py-28", className)}>
      <figure className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
        <blockquote className="col-span-4 lg:col-span-10 lg:col-start-2">
          <p className="ds-serif text-[40px] leading-[1.02] tracking-[-0.03em] lg:text-[88px]">{text}</p>
        </blockquote>
        {source && (
          <figcaption className="ds-caps col-span-4 mt-8 text-ds-muted lg:col-span-10 lg:col-start-2">{source}</figcaption>
        )}
      </figure>
    </section>
  );
}
