import type { Db } from "./data.js";

/** The topics (pillars) clips are filed under, for the Library's topic Dropdown. Read-only, at most 40. */
export async function loadPillars(pool: Db): Promise<string[]> {
  const { rows } = (await pool.query(
    "select distinct pillar from media where pillar is not null and btrim(pillar) <> '' order by pillar limit 40",
  )) as { rows: Array<{ pillar: string }> };
  return rows.map((r) => r.pillar);
}
