import { describe, expect, it } from "vitest";
import { RESEARCH_REFRESH_CRON } from "@autopilot/research";
import { registerResearchRefreshJob, researchEnvFromEnv, researchStartupLine, RESEARCH_REFRESH_QUEUE } from "../jobs/research-refresh.js";

function fakeBoss() {
  const calls: string[] = [];
  return {
    calls,
    async createQueue(n: string) {
      calls.push(`create ${n}`);
    },
    async work(n: string) {
      calls.push(`work ${n}`);
    },
    async schedule(n: string, cron: string) {
      calls.push(`schedule ${n} ${cron}`);
    },
    async send(n: string) {
      calls.push(`send ${n}`);
    },
  };
}
const pool = (runs: number) => ({ query: async () => ({ rows: runs ? [{ "?column?": 1 }] : [] }) }) as any;

describe("research-refresh job wiring", () => {
  it("reads env without leaking values; AI notes need RESEARCH_AI_NOTES=1", () => {
    expect(researchEnvFromEnv({})).toEqual({ aiNotesEnv: false, blocklist: [] });
    const cfg = researchEnvFromEnv({ META_ACCESS_TOKEN: "tok-secret", IG_USER_ID: "123", RESEARCH_AI_NOTES: "1", ANTHROPIC_API_KEY: "k" });
    expect(cfg.instagram).toEqual({ accessToken: "tok-secret", igUserId: "123", graphVersion: "v25.0" });
    expect(cfg.aiNotesEnv).toBe(true);
    expect(researchEnvFromEnv({ META_ACCESS_TOKEN: "t", IG_USER_ID: "not-numeric" }).instagram).toBeUndefined();
    const line = researchStartupLine(cfg);
    expect(line).not.toContain("tok-secret");
    expect(line).toContain(RESEARCH_REFRESH_CRON);
    expect(researchStartupLine(researchEnvFromEnv({}))).toContain("niche + scripts only");
  });

  it("schedules every 3 days and queues one run at start only if it never ran", async () => {
    const fresh = fakeBoss();
    await registerResearchRefreshJob(fresh, pool(0), researchEnvFromEnv({}));
    expect(fresh.calls).toEqual([`create ${RESEARCH_REFRESH_QUEUE}`, `work ${RESEARCH_REFRESH_QUEUE}`, `schedule ${RESEARCH_REFRESH_QUEUE} ${RESEARCH_REFRESH_CRON}`, `send ${RESEARCH_REFRESH_QUEUE}`]);
    const ran = fakeBoss();
    await registerResearchRefreshJob(ran, pool(1), researchEnvFromEnv({}));
    expect(ran.calls).not.toContain(`send ${RESEARCH_REFRESH_QUEUE}`);
  });
});
