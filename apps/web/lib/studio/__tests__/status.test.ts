import { describe, expect, it } from "vitest";
import { isFinished, parseStatus, statusLabel } from "../status.js";

describe("status", () => {
  it("finds the row by id and rejects junk", () => {
    expect(parseStatus([{ id: "x", status: "running" }], "x")).toMatchObject({ status: "running" });
    expect(parseStatus([{ id: "y", status: "done" }], "x")).toBeNull();
    expect(parseStatus([{ id: "x", status: "weird" }], "x")).toBeNull();
    expect(parseStatus({}, "x")).toBeNull();
  });
  it("labels and finish", () => {
    expect(isFinished("done")).toBe(true);
    expect(isFinished("running")).toBe(false);
    expect(statusLabel("running")).toBe("Rendering");
  });
});
