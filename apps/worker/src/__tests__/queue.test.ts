import { describe, expect, it } from "vitest";
import { QUEUES, createQueue } from "../queue.js";

describe("createQueue", () => {
  it("builds a PgBoss instance from a connection string without connecting", () => {
    const boss = createQueue("postgresql://user:pass@localhost:5432/db");
    expect(boss).toBeTruthy();
  });

  it("names the health queue", () => {
    expect(QUEUES.health).toBe("health-check");
  });
});
