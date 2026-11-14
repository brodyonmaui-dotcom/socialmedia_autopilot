import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Static v2 scan over the restyled controls: sharp corners, no elevation (docs/design/ui-system.md). */
const UI = join(dirname(fileURLToPath(import.meta.url)), "..");

const FILES = [
  "Button.tsx", "Toggle.tsx", "toggle-state.ts", "Checkbox.tsx", "Radio.tsx", "Tabs.tsx", "TabsClient.tsx",
  "tab-styles.tsx", "Badge.tsx", "Input.tsx", "Select.tsx", "Stepper.tsx", "stepper-math.ts", "ProgressBar.tsx",
  "Slider.tsx", "Sheet.tsx", "AlertCard.tsx", "EmptyState.tsx", "Tooltip.tsx", "PageDots.tsx", "Card.tsx",
  "StatTile.tsx", "ListRow.tsx", "Sparkline.tsx", "Donut.tsx", "MonthCalendar.tsx", "chart-math.ts",
];

/** Files allowed to use rounded-full: pill button, badge, toggle track/knob, radio dot, slider knob. */
const ROUND_OK = new Set(["Button.tsx", "Badge.tsx", "Toggle.tsx", "Radio.tsx", "Slider.tsx"]);
/** Files allowed to use the one remaining shadow token. */
const POP_OK = new Set(["Sheet.tsx", "Tooltip.tsx"]);

const src = (f: string) => readFileSync(join(UI, f), "utf8");
/** Class-like tokens that start a rounded utility (any variant prefix), e.g. `sm:rounded-ds-xl`, `rounded`. */
/** Only string literals carry class names (comments may say "rounded" in prose). */
const literals = (s: string) => (s.match(/"[^"\n]*"|`[^`]*`/g) ?? []).join(" ");
const roundedTokens = (s: string) =>
  literals(s).match(/(?<![\w-])(?:[\w-]+:|\[[^\]]*\]:)*rounded(?:-[\w[\]/.-]+)?(?![\w-])/g) ?? [];

describe("v2 static scan (my controls)", () => {
  it.each(FILES)("%s has no v1 radius/elevation tokens", (f) => {
    const s = src(f);
    expect(s).not.toContain("shadow-ds-card");
    expect(s).not.toContain("shadow-ds-glow");
    expect(s).not.toContain("rounded-ds-");
    expect(s).not.toContain("rounded-[");
    expect(s).not.toMatch(/rounded-t-/);
    expect(s).not.toMatch(/\bshadow-(sm|md|lg|xl)\b/);
  });

  it.each(FILES)("%s only uses rounded-full, and only where v2 allows it", (f) => {
    const toks = roundedTokens(src(f)).map((t) => t.replace(/^.*:/, ""));
    for (const t of toks) expect(t).toBe("rounded-full");
    if (!ROUND_OK.has(f)) expect(toks).toEqual([]);
  });

  it.each(FILES)("%s uses shadow-ds-pop only on Sheet/Tooltip", (f) => {
    if (!POP_OK.has(f)) expect(src(f)).not.toContain("shadow-ds-pop");
  });
});
