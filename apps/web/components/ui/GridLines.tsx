import { cx } from "./cx.js";

const COLS = 12;

/** The one content container: same max width and gutters as the grid lines and header. */
export const CONTAINER = "mx-auto w-full max-w-[var(--ds-max)] px-[var(--ds-gutter)]";

/**
 * Fixed, decorative column lines behind the content: 4 columns on phones/tablets, 12 at ≥1024px.
 * Same max width and gutter as SiteHeader's container so content cells sit on the lines.
 */
export function GridLines() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
      <div className={cx(CONTAINER, "grid h-full grid-cols-4 lg:grid-cols-12")}>
        {Array.from({ length: COLS }, (_, i) => (
          <div
            key={i}
            className={cx(
              "border-l border-ds-grid",
              i === 3 && "border-r lg:border-r-0",
              i === COLS - 1 && "border-r",
              i >= 4 && "hidden lg:block",
            )}
          />
        ))}
      </div>
    </div>
  );
}
