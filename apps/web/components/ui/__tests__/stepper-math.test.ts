import { describe, expect, it } from "vitest";
import { stepDecimals, stepValue } from "../stepper-math.js";

describe("stepValue", () => {
  it("steps by 1 by default", () => {
    expect(stepValue(3, 1)).toBe(4);
    expect(stepValue(3, -1)).toBe(2);
  });

  it("clamps to min and max", () => {
    expect(stepValue(5, 1, { min: 0, max: 5 })).toBe(5);
    expect(stepValue(0, -1, { min: 0, max: 5 })).toBe(0);
    expect(stepValue(4, 1, { max: 5, step: 3 })).toBe(5);
    expect(stepValue(-10, 1, { min: 0 })).toBe(0);
  });

  it("uses the step size", () => {
    expect(stepValue(10, 1, { step: 5 })).toBe(15);
    expect(stepValue(10, -1, { step: 5 })).toBe(5);
  });

  it("does not drift with decimal steps", () => {
    let v = 0;
    for (let i = 0; i < 3; i++) v = stepValue(v, 1, { step: 0.1 });
    expect(v).toBe(0.3);
    expect(stepValue(0.2, 1, { step: 0.1 })).toBe(0.3);
    expect(stepValue(1.15, -1, { step: 0.05 })).toBe(1.1);
    let w = 1;
    for (let i = 0; i < 10; i++) w = stepValue(w, -1, { step: 0.1, min: 0 });
    expect(w).toBe(0);
  });

  it("keeps the value's own precision", () => {
    expect(stepValue(0.25, 1, { step: 1 })).toBe(1.25);
  });

  it("treats a bad step as 1 and NaN as min", () => {
    expect(stepValue(2, 1, { step: 0 })).toBe(3);
    expect(stepValue(Number.NaN, 1, { min: 4 })).toBe(5);
  });

  it("counts decimals incl. exponent notation", () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(0.25)).toBe(2);
    expect(stepDecimals(1e-7)).toBe(7);
  });
});
