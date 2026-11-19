import { describe, expect, it } from "vitest";
import { ALERT_KINDS, PUSH_KINDS_DEFAULT, isAlertKind } from "../types.js";

describe("alert kinds (F14 weekly loop)", () => {
  it("declares batch-ready and report-ready", () => {
    expect(ALERT_KINDS).toContain("batch-ready");
    expect(ALERT_KINDS).toContain("report-ready");
    expect(isAlertKind("batch-ready")).toBe(true);
    expect(isAlertKind("report-ready")).toBe(true);
    expect(new Set(ALERT_KINDS).size).toBe(ALERT_KINDS.length);
  });

  it("batch-ready is pushed by default, report-ready is page-only", () => {
    expect(PUSH_KINDS_DEFAULT).toContain("batch-ready");
    expect(PUSH_KINDS_DEFAULT).not.toContain("report-ready");
    for (const k of PUSH_KINDS_DEFAULT) expect(isAlertKind(k)).toBe(true);
  });
});
