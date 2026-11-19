import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { envFilePath } from "../load-env.js";

describe("envFilePath", () => {
  it("uses INIT_CWD (where pnpm was started) over the package cwd", () => {
    expect(envFilePath({ INIT_CWD: resolve("/repo") }, resolve("/repo/tools/ingest-agent"))).toBe(resolve("/repo/.env"));
  });

  it("falls back to cwd when not run through pnpm", () => {
    expect(envFilePath({}, resolve("/repo"))).toBe(resolve("/repo/.env"));
  });
});
