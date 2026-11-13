import { describe, expect, it } from "vitest";
import { buttonClasses, type ButtonVariant } from "../Button.js";

const tokens = (s: string) => s.split(/\s+/);
const ALL: ButtonVariant[] = ["solid", "accent", "outline", "white", "ghost", "icon", "pill"];
const roundedTokens = (s: string) => tokens(s).filter((t) => /(^|:)rounded/.test(t));

describe("buttonClasses (v2 Warm Industrial)", () => {
  it("solid (default) is the black invert rectangle with caps label", () => {
    const c = tokens(buttonClasses());
    expect(c).toEqual(
      expect.arrayContaining(["bg-ds-invert", "text-ds-on-invert", "ds-caps", "h-12", "px-6", "hover:bg-ds-accent", "hover:text-ds-ink"]),
    );
    expect(c).not.toContain("bg-ds-accent");
  });

  it("accent is blue fill with ink label", () => {
    expect(tokens(buttonClasses({ variant: "accent" }))).toEqual(expect.arrayContaining(["bg-ds-accent", "text-ds-ink"]));
  });

  it("outline is a 1px text line that inverts on hover", () => {
    expect(tokens(buttonClasses({ variant: "outline" }))).toEqual(
      expect.arrayContaining(["border", "border-ds-text/80", "text-ds-text", "hover:bg-ds-text", "hover:text-ds-bg"]),
    );
  });

  it("white is a card fill with a 1px line; ghost is accent text", () => {
    expect(tokens(buttonClasses({ variant: "white" }))).toEqual(expect.arrayContaining(["bg-ds-card", "border", "border-ds-line"]));
    expect(tokens(buttonClasses({ variant: "ghost" }))).toContain("text-ds-accent-fg");
  });

  it("pill is rounded-full, 1px border, 44px tall caps", () => {
    const c = tokens(buttonClasses({ variant: "pill" }));
    expect(c).toEqual(expect.arrayContaining(["rounded-full", "border", "border-ds-text", "h-11", "px-5", "ds-caps"]));
    expect(c).not.toContain("h-12");
  });

  it("only pill is round: no rounded-* on any other variant, and pill only uses rounded-full", () => {
    for (const variant of ALL) {
      for (const tone of ["default", "danger"] as const) {
        const r = roundedTokens(buttonClasses({ variant, tone }));
        if (variant === "pill") expect(r).toEqual(["rounded-full"]);
        else expect(r).toEqual([]);
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

  it("icon is a 44px bordered square", () => {
    const c = tokens(buttonClasses({ variant: "icon" }));
    expect(c).toEqual(expect.arrayContaining(["size-11", "border", "border-ds-line"]));
    expect(c).not.toContain("h-12");
  });

  it("sm is 44px tall", () => {
    expect(tokens(buttonClasses({ size: "sm" }))).toContain("h-11");
  });

  it("danger tone swaps colours instead of stacking them", () => {
    const o = tokens(buttonClasses({ variant: "outline", tone: "danger" }));
    expect(o).toEqual(expect.arrayContaining(["text-ds-danger", "border-ds-danger/50"]));
    expect(o).not.toContain("text-ds-text");
    expect(tokens(buttonClasses({ variant: "ghost", tone: "danger" }))).toContain("text-ds-danger");
    expect(tokens(buttonClasses({ variant: "icon", tone: "danger" }))).toContain("text-ds-danger");
    expect(tokens(buttonClasses({ variant: "pill", tone: "danger" }))).toEqual(expect.arrayContaining(["rounded-full", "text-ds-danger"]));
  });

  it("arrow adds the hover group", () => {
    expect(tokens(buttonClasses({ arrow: true }))).toContain("group");
    expect(tokens(buttonClasses())).not.toContain("group");
  });

  it("block, disabled and className", () => {
    const s = buttonClasses({ block: true, disabled: true, className: "mt-4" });
    expect(tokens(s)).toEqual(expect.arrayContaining(["w-full", "opacity-50", "cursor-not-allowed", "mt-4"]));
  });

  it("has a focus ring and a 300ms ease-ds colour transition", () => {
    const s = buttonClasses({ variant: "ghost" });
    expect(s).toContain("focus-visible:outline-2");
    expect(tokens(s)).toEqual(expect.arrayContaining(["transition-colors", "duration-300", "ease-ds"]));
  });
});
