import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Static v3 scan over every design-system file (docs/design/ui-system.md hard rules). */
const UI = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = readdirSync(UI).filter((f) => /\.(tsx|ts)$/.test(f));

/** Only overlays may lift off the page. */
const POP_OK = new Set(["Sheet.tsx", "Popover.tsx", "Dialog.tsx", "Sidebar.tsx", "BarChart.tsx", "LineChart.tsx"]);

const src = (f: string) => readFileSync(join(UI, f), "utf8");
/** Only string literals carry class names (comments may mention them in prose). */
const literals = (s: string) => (s.match(/"[^"\n]*"|`[^`]*`/g) ?? []).join(" ");
const SCANNED = FILES;

describe("v3 static scan", () => {
  it.each(SCANNED)("%s: radius only from tokens (rounded-ds-*, rounded-full)", (f) => {
    const toks = literals(src(f)).match(/(?<![\w-])(?:[\w-]+:)*rounded(?:-[\w[\]/.-]+)?(?![\w-])/g) ?? [];
    for (const t of toks) expect(t.replace(/^.*:/, "")).toMatch(/^rounded-(?:[tblr]-)?(?:ds-(?:xs|sm|md|lg|xl|bar)|full)$/);
  });

  it.each(SCANNED)("%s: no monospace, no outline text, no marquee/pulse/grid tokens", (f) => {
    const s = literals(src(f));
    expect(s).not.toMatch(/\bfont-mono\b|mono-ds|ds-stroke|animate-ds-|border-ds-grid|text-stroke/);
  });

  it.each(SCANNED)("%s: no ad-hoc shadows; pop shadow only on overlays", (f) => {
    const s = literals(src(f));
    expect(s).not.toMatch(/\bshadow-(sm|md|lg|xl|2xl)\b|shadow-\[/);
    if (!POP_OK.has(f)) expect(s).not.toContain("shadow-ds-pop");
  });

  it.each(SCANNED)("%s: no green", (f) => {
    expect(literals(src(f))).not.toMatch(/-(green|emerald|lime)-/);
  });

  it("the v2 components are gone (ui-system.md: removed in run 4)", () => {
    const gone = ["GridLines", "NoiseOverlay", "Marquee", "FooterBand", "Display", "Readout", "StatusPulse", "RevealList", "GlassCard", "Statement", "StatusBars", "SectionHead", "SiteHeader", "TabBar", "HeaderMenu", "FramedImage"];
    for (const name of gone) expect(FILES, name).not.toContain(`${name}.tsx`);
    const index = src("index.ts");
    for (const name of gone) expect(index, name).not.toContain(`./${name}.js`);
  });

  it("globals.css has no v2 alias utilities left", () => {
    const css = readFileSync(join(UI, "../../app/globals.css"), "utf8");
    expect(css).not.toMatch(/@utility ds-(caps|mono|serif|stroke|display)\b/);
  });

  it("globals.css has no monospace or grid tokens left", () => {
    const css = readFileSync(join(UI, "../../app/globals.css"), "utf8");
    expect(css).not.toMatch(/monospace|--font-mono|--color-ds-grid|ds-marquee|ds-pulse/);
    expect(css).toContain('@import "@fontsource-variable/imbue/opsz.css"');
    expect(css).toContain("--radius-ds-lg: 12px");
    expect(css).toContain("--radius-ds-sm: 8px");
  });
});
