import { describe, expect, it } from "vitest";
import { LIVE_FLAG, resolveRunMode } from "../run-mode.js";

const argv = ["node", "src/index.ts"];

describe("resolveRunMode", () => {
  it("defaults to dry-run with no reason", () => {
    expect(resolveRunMode({}, argv)).toEqual({ dryRun: true, live: false, reason: null });
  });

  it("DRY_RUN=false alone stays dry-run and names the missing key", () => {
    const m = resolveRunMode({ DRY_RUN: "false" }, argv);
    expect(m.dryRun).toBe(true);
    expect(m.live).toBe(false);
    expect(m.reason).toBe("live refused: DRY_RUN is false but no live key (pass the argv flag or WORKER_LIVE=1); running dry-run");
  });

  it("DRY_RUN=false + WORKER_LIVE=1 is live", () => {
    expect(resolveRunMode({ DRY_RUN: "false", WORKER_LIVE: "1" }, argv)).toEqual({ dryRun: false, live: true, reason: null });
  });

  it("DRY_RUN=false + the argv flag is live", () => {
    expect(resolveRunMode({ DRY_RUN: "false" }, [...argv, LIVE_FLAG])).toEqual({ dryRun: false, live: true, reason: null });
  });

  it("DRY_RUN=true + the argv flag stays dry-run", () => {
    const m = resolveRunMode({ DRY_RUN: "true" }, [...argv, LIVE_FLAG]);
    expect(m).toMatchObject({ dryRun: true, live: false });
    expect(m.reason).toContain("DRY_RUN is not false");
  });

  it("WORKER_LIVE other than 1 is not a live key", () => {
    expect(resolveRunMode({ DRY_RUN: "false", WORKER_LIVE: "true" }, argv).dryRun).toBe(true);
  });
});
