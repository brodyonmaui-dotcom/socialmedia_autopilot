import { describe, expect, it } from "vitest";
import { assertDevSessionAllowed } from "../lib/dev-session.js";

const LOCAL = "postgres://ap:ap@localhost:5432/autopilot_dev";

describe("assertDevSessionAllowed", () => {
  it("refuses production", () => {
    expect(() => assertDevSessionAllowed({ NODE_ENV: "production", DATABASE_URL: LOCAL })).toThrow(/production/);
  });
  it("refuses a non-local database", () => {
    expect(() => assertDevSessionAllowed({ NODE_ENV: "development", DATABASE_URL: "postgres://u:p@db:5432/autopilot" })).toThrow(/non-local/);
    expect(() => assertDevSessionAllowed({})).toThrow();
  });
  it("allows local + dev", () => {
    expect(assertDevSessionAllowed({ NODE_ENV: "development", DATABASE_URL: LOCAL })).toBe(LOCAL);
    expect(assertDevSessionAllowed({ DATABASE_URL: LOCAL })).toBe(LOCAL);
  });
});
