import { describe, expect, it } from "vitest";
import { buttonClasses, type ButtonVariant } from "../Button.js";

const tokens = (s: string) => s.split(/\s+/);

describe("buttonClasses", () => {
  it("solid (default) is accent fill with ink label, never white text", () => {
    const c = tokens(buttonClasses());
    expect(c).toContain("bg-ds-accent");
    expect(c).toContain("text-ds-ink");
    expect(c).toContain("ds-caps");
    expect(c).toContain("h-12");
  });

  it("no variant ever uses white text or green", () => {
    for (const variant of ["solid", "outline", "white", "ghost", "icon"] as ButtonVariant[]) {
      for (const tone of ["default", "danger"] as const) {
        const s = buttonClasses({ variant, tone });
        expect(s).not.toMatch(/\btext-white\b/);
        expect(s).not.toMatch(/-(green|emerald|lime)-/);
      }
    }
  });

  it("icon is a 44px square", () => {
    const c = tokens(buttonClasses({ variant: "icon" }));
    expect(c).toContain("size-11");
    expect(c).not.toContain("h-12");
  });

  it("sm is 44px tall", () => {
    expect(tokens(buttonClasses({ size: "sm" }))).toContain("h-11");
  });

  it("danger outline is coral", () => {
    const c = tokens(buttonClasses({ variant: "outline", tone: "danger" }));
    expect(c).toContain("text-ds-danger");
    expect(c).toContain("border-ds-danger/50");
  });

  it("block, disabled and className", () => {
    const s = buttonClasses({ block: true, disabled: true, className: "mt-4" });
    expect(tokens(s)).toEqual(expect.arrayContaining(["w-full", "opacity-50", "cursor-not-allowed", "mt-4"]));
  });

  it("has a focus ring and 200ms ease-ds transition", () => {
    const s = buttonClasses({ variant: "ghost" });
    expect(s).toContain("focus-visible:outline-2");
    expect(tokens(s)).toEqual(expect.arrayContaining(["duration-200", "ease-ds"]));
  });
});
