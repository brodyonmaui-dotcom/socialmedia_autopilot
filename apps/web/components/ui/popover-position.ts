// Pure placement math for Popover / Menu (anchored, flips at the viewport edge). Tested in __tests__/popover-position.test.ts.

export type AnchorRect = { top: number; left: number; bottom: number; right: number; width: number; height: number };
export type Placement = { top: number; left: number; side: "below" | "above"; maxHeight: number };

/**
 * Where to put a `panel`-sized box anchored to `anchor` inside a `vw × vh` viewport.
 * Below the anchor by default; above when it doesn't fit below and there is more room above.
 * `align: "end"` lines the panel's right edge up with the anchor's. Always clamped `margin` px inside the viewport.
 */
export function placePanel(
  anchor: AnchorRect,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { align?: "start" | "end"; gap?: number; margin?: number } = {},
): Placement {
  const gap = opts.gap ?? 8;
  const margin = opts.margin ?? 8;
  const below = viewport.height - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const side: Placement["side"] = panel.height <= below || below >= above ? "below" : "above";
  const room = Math.max(120, side === "below" ? below : above);
  const h = Math.min(panel.height, room);
  const top = side === "below" ? anchor.bottom + gap : anchor.top - gap - h;
  const wanted = opts.align === "end" ? anchor.right - panel.width : anchor.left;
  const maxLeft = viewport.width - margin - panel.width;
  const left = Math.max(margin, Math.min(wanted, maxLeft));
  return { top: Math.round(top), left: Math.round(left), side, maxHeight: Math.floor(room) };
}

/** Next index for arrow-key menu navigation (wraps). `key` is a KeyboardEvent.key. Null = not a nav key. */
export function nextIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
