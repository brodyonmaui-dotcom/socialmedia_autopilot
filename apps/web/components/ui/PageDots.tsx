import Link from "next/link";
import { cx, FOCUS } from "./cx.js";

export interface PageDotsProps {
  count: number;
  /** 0-based index of the current page. */
  active: number;
  /** Group label, e.g. "Week preview". */
  label: string;
  /** When given, each dot is a link (≥44px hit area via padding). */
  hrefFor?: (i: number) => string;
  className?: string;
}

function dot(on: boolean) {
  return cx(
    "block h-0.5 transition-all duration-300 ease-ds",
    on ? "w-6 bg-ds-text" : "w-3 bg-ds-line-strong",
  );
}

export function PageDots({ count, active, label, hrefFor, className }: PageDotsProps) {
  const n = Math.max(0, Math.floor(count));
  const idx = Array.from({ length: n }, (_, i) => i);
  return (
    <div role="group" aria-label={label} className={cx("flex items-center justify-center", hrefFor ? "gap-0" : "gap-2", className)}>
      <span className="sr-only">
        Page {Math.min(n, active + 1)} of {n}
      </span>
      {idx.map((i) =>
        hrefFor ? (
          <Link
            key={i}
            href={hrefFor(i)}
            aria-label={`Page ${i + 1} of ${n}`}
            aria-current={i === active ? "page" : undefined}
            className={cx("inline-flex min-h-11 min-w-11 items-center justify-center", FOCUS)}
          >
            <span aria-hidden="true" className={dot(i === active)} />
          </Link>
        ) : (
          <span key={i} aria-hidden="true" className={dot(i === active)} />
        ),
      )}
    </div>
  );
}
