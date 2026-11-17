import { describe, expect, it } from "vitest";
import { buttonClasses, type ButtonVariant } from "../Button.js";

const tokens = (s: string) => s.split(/\s+/);
const ALL: ButtonVariant[] = ["solid", "accent", "outline", "white", "ghost", "icon", "pill"];
const roundedTokens = (s: string) => tokens(s).filter((t) => /(^|:)rounded/.test(t));

describe("buttonClasses (v3)", () => {
  it("solid (default) is the ink fill, 8px radius, sentence-case 600", () => {
    const c = tokens(buttonClasses());
    expect(c).toEqual(expect.arrayContaining(["bg-ds-invert", "text-ds-on-invert", "rounded-ds-sm", "font-semibold", "h-11"]));
    expect(c).not.toContain("ds-caps");
    expect(c).not.toContain("uppercase");
  });

  it("outline is a control-border hairline that fills raised on hover", () => {
    expect(tokens(buttonClasses({ variant: "outline" }))).toEqual(expect.arrayContaining(["border", "border-ds-line-strong", "text-ds-text", "hover:bg-ds-raised"]));
  });

  it("ghost is ink text with a raised hover", () => {
    expect(tokens(buttonClasses({ variant: "ghost" }))).toEqual(expect.arrayContaining(["text-ds-text", "hover:bg-ds-raised"]));
  });

  it("radius: pill is rounded-full, every other variant rounded-ds-sm", () => {
    for (const variant of ALL) {
      for (const tone of ["default", "danger"] as const) {
        expect(roundedTokens(buttonClasses({ variant, tone }))).toEqual([variant === "pill" ? "rounded-full" : "rounded-ds-sm"]);
      }
    }
  });

  it("no variant uses white text, green or shadows", () => {
    for (const variant of ALL) {
      for (const tone of ["default", "danger"] as const) {
        const s = buttonClasses({ variant, tone });
        expect(s).not.toMatch(/\btext-white\b/);
        expect(s).not.toMatch(/-(green|emerald|lime)-/);
        expect(s).not.toMatch(/\bshadow-/);
      }
    }
  });

  it("tap targets: md and sm are 44px tall on phones; sm tightens to 36px on desktop", () => {
    expect(tokens(buttonClasses())).toContain("h-11");
    expect(tokens(buttonClasses({ size: "sm" }))).toEqual(expect.arrayContaining(["h-11", "lg:h-9"]));
    expect(tokens(buttonClasses({ variant: "icon" }))).toContain("size-11");
  });

  it("danger tone swaps colours instead of stacking them", () => {
    const o = tokens(buttonClasses({ variant: "outline", tone: "danger" }));
    expect(o).toEqual(expect.arrayContaining(["text-ds-danger", "border-ds-danger/60"]));
    expect(o).not.toContain("text-ds-text");
    expect(tokens(buttonClasses({ variant: "ghost", tone: "danger" }))).toContain("text-ds-danger");
  });

  it("block, disabled, arrow group and className", () => {
    const s = buttonClasses({ block: true, disabled: true, arrow: true, className: "mt-4" });
    expect(tokens(s)).toEqual(expect.arrayContaining(["w-full", "opacity-50", "cursor-not-allowed", "group", "mt-4"]));
  });

  it("has a focus ring and a colour-only transition", () => {
    const s = buttonClasses({ variant: "ghost" });
    expect(s).toContain("focus-visible:outline-2");
    expect(tokens(s)).toEqual(expect.arrayContaining(["transition-colors", "ease-ds"]));
  });
});
